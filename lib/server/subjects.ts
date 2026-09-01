import "server-only";

import fs from "node:fs/promises";
import { z } from "zod";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/server/frontmatter";
import { atomicWrite, listPdfIds, subjectPath } from "@/lib/server/workspace";

/**
 * `subject.md` — the user-owned file that groups a PDF under a subject. It
 * lives beside `source.pdf` rather than in `.cache/`, so deleting the cache (or
 * dropping the folder into git) never loses the grouping.
 *
 * The file is a user's to edit by hand, so a missing, broken, or wrong-shaped
 * one is read as "ungrouped" with a warning — never as an error.
 */
export const SubjectFrontmatterSchema = z.object({
  subject: z.string().default(""),
});

/** A PDF's subject, or undefined when it has none. Never throws on a broken file. */
export async function readSubject(id: string): Promise<string | undefined> {
  // Outside the try: an invalid id is a caller bug, not a missing file.
  const filePath = subjectPath(id);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
  const { data } = parseFrontmatter(raw);
  const parsed = SubjectFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    console.warn(`[subjects] ${id}/subject.md has invalid frontmatter — treating as ungrouped`);
    return undefined;
  }
  return parsed.data.subject.trim() || undefined;
}

/**
 * Set (or, with an empty string, clear) a PDF's subject. Anything the user
 * wrote below the frontmatter is read back and rewritten verbatim — the file is
 * theirs, and this only ever touches the one field.
 */
export async function writeSubject(id: string, subject: string): Promise<void> {
  const filePath = subjectPath(id);
  let body = "";
  try {
    body = parseFrontmatter(await fs.readFile(filePath, "utf8")).body;
  } catch {
    // No file yet — start with an empty body.
  }
  await atomicWrite(filePath, serializeFrontmatter({ subject }, body));
}

/**
 * Every grouped PDF's subject, keyed by id. Deliberately reads `subject.md`
 * only: unlike `readMeta` it never triggers a re-index, so rendering the
 * library or the map stays cheap.
 */
export async function subjectByPdfId(): Promise<Map<string, string>> {
  const ids = await listPdfIds();
  const subjects = await Promise.all(ids.map((id) => readSubject(id)));
  const byId = new Map<string, string>();
  ids.forEach((id, index) => {
    const subject = subjects[index];
    if (subject) byId.set(id, subject);
  });
  return byId;
}

/** Every subject in use, deduped and sorted. */
export async function listSubjects(): Promise<string[]> {
  const subjects = new Set((await subjectByPdfId()).values());
  return [...subjects].sort((a, b) => a.localeCompare(b));
}

/** The ids of every PDF filed under `subject` — an exact match, no slugging. */
export async function listPdfIdsWithSubject(subject: string): Promise<string[]> {
  const byId = await subjectByPdfId();
  return [...byId.entries()].filter(([, value]) => value === subject).map(([id]) => id);
}
