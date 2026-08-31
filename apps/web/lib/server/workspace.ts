import "server-only";

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Root of the user-owned workspace: one directory per PDF, plus a `concepts/`
 * directory. Everything under it belongs to the user (git/Obsidian/an editor
 * may touch it at any time) except each PDF's `.cache/`, which the app owns and
 * can always rebuild. Relative paths resolve against the process cwd.
 */
export const WORKSPACE_ROOT = path.resolve(process.env.STUDY_WORKSPACE ?? "workspace");

/**
 * A PDF id doubles as its directory name and its URL segment, so it is
 * deliberately narrow: lowercase alphanumerics and dashes, leading char
 * alphanumeric, at most 100 chars. Anything else is rejected before it ever
 * reaches the filesystem.
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** `concepts/` route segments that would collide with app routes. */
const RESERVED_CONCEPT_SLUGS = new Set(["graph", "refresh"]);

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** Derive a filesystem-safe slug from a filename (extension stripped). */
export function slugify(filename: string): string {
  const base = path.basename(filename).replace(/\.pdf$/i, "");
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "");
  // Non-Latin filenames can slugify away to nothing — fall back to a generic
  // stem so the collision loop can still find a free directory name.
  return ID_PATTERN.test(slug) ? slug : "pdf";
}

/** A concept slug, kept clear of the route segments `concepts/` reserves. */
export function conceptSlug(name: string): string {
  const slug = slugify(name);
  return RESERVED_CONCEPT_SLUGS.has(slug) ? `${slug}-concept` : slug;
}

/**
 * Resolve a path inside the workspace, rejecting anything that escapes it.
 * Every filesystem access in the app goes through here — the id is pattern
 * checked first, then the resolved path is re-checked against the root so a
 * traversal attempt can never touch a file outside the workspace.
 */
function resolveInWorkspace(...segments: string[]): string {
  const resolved = path.resolve(WORKSPACE_ROOT, ...segments);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error("path escapes the workspace root");
  }
  return resolved;
}

export function pdfDir(id: string): string {
  if (!isValidId(id)) throw new Error(`invalid pdf id: ${id}`);
  return resolveInWorkspace(id);
}

export function sourcePath(id: string): string {
  return path.join(pdfDir(id), "source.pdf");
}

export function cacheDir(id: string): string {
  return path.join(pdfDir(id), ".cache");
}

export function metaPath(id: string): string {
  return path.join(cacheDir(id), "meta.json");
}

/** Page files are zero-padded to 3 digits so they sort correctly in any editor. */
export function pageStem(pageNumber: number): string {
  return `page-${String(pageNumber).padStart(3, "0")}`;
}

export function pageTextPath(id: string, pageNumber: number): string {
  return path.join(cacheDir(id), "text", `${pageStem(pageNumber)}.txt`);
}

export function pageNotePath(id: string, pageNumber: number): string {
  return path.join(pdfDir(id), "notes", `${pageStem(pageNumber)}.md`);
}

export function conceptsDir(): string {
  return resolveInWorkspace("concepts");
}

export function conceptPath(slug: string): string {
  if (!isValidId(slug)) throw new Error(`invalid concept slug: ${slug}`);
  return path.join(conceptsDir(), `${slug}.md`);
}

/** Validate a 1-indexed page number against a document's page count. */
export function isValidPageNumber(pageNumber: number, pageCount: number): boolean {
  return Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= pageCount;
}

/**
 * Write a file via a temp file + rename, so a reader (or an external editor
 * watching the directory) never observes a half-written file.
 */
export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Claim a fresh directory for `slug`, suffixing `-2`, `-3`, … on collision.
 * `mkdir` without `recursive` fails with EEXIST if the name is taken, so the
 * claim is atomic — an existing PDF directory is never overwritten.
 */
export async function claimPdfDir(slug: string): Promise<string> {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? slug : `${slug}-${n}`.slice(0, 100).replace(/-+$/, "");
    try {
      await fs.mkdir(pdfDir(candidate));
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

/** Directory names directly under the workspace root that hold a PDF. */
export async function listPdfIds(): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory() && e.name !== "concepts" && isValidId(e.name))
    .map((e) => e.name);
}
