import "server-only";

import fs from "node:fs/promises";
import { pdf as pdfRender } from "pdf-to-img";
import type { ExtractionReport, PdfSummary } from "@/lib/schemas";
import { indexPdf, readMeta, type PdfMeta } from "@/lib/server/meta";
import {
  claimPdfDir,
  listPdfIds,
  pageTextPath,
  pdfDir,
  slugify,
  sourcePath,
} from "@/lib/server/workspace";

type PdfDocument = Awaited<ReturnType<typeof pdfRender>>;

interface DocCacheEntry {
  document: PdfDocument;
  /** Lazily-rendered PNG buffers, keyed by 1-indexed page number. */
  pages: Map<number, Buffer>;
}

/** Parsed documents + rendered PNGs are memory-heavy, so only a few are kept. */
const DOC_CACHE_LIMIT = 3;

/**
 * Process-local cache of parsed PDF documents and their rendered page images.
 * The durable record is `source.pdf` on disk; this only holds the
 * non-serializable `pdf-to-img` document and the rendered PNGs, both cheap to
 * rebuild. Insertion-ordered, so evicting the first key drops the oldest entry.
 */
const docCache = new Map<string, DocCacheEntry>();

function toSummary(meta: PdfMeta): PdfSummary {
  return {
    id: meta.id,
    filename: meta.filename,
    pageCount: meta.pageCount,
    createdAt: meta.createdAt,
  };
}

/**
 * Store a PDF in the workspace and index it. Text extraction runs synchronously
 * — the upload blocks for a second or two, which buys the app a world with no
 * status machine and no progress polling. A failure leaves nothing behind: the
 * half-built directory is removed before the error propagates.
 */
export async function addPdf(buffer: Buffer, filename: string): Promise<PdfSummary> {
  const id = await claimPdfDir(slugify(filename));
  try {
    await fs.writeFile(sourcePath(id), buffer);
    const meta = await indexPdf(id, buffer, filename, new Date().toISOString());
    console.info(`[extract] pdf=${id} report=${JSON.stringify(meta.extraction)}`);
    return toSummary(meta);
  } catch (err) {
    await fs.rm(pdfDir(id), { recursive: true, force: true });
    throw err;
  }
}

/** Every PDF in the workspace, newest first. Directories with no cache are re-indexed. */
export async function listPdfs(): Promise<PdfSummary[]> {
  const ids = await listPdfIds();
  const metas = await Promise.all(ids.map((id) => readMeta(id)));
  return metas
    .filter((meta): meta is PdfMeta => meta !== undefined)
    .map(toSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPdfSummary(id: string): Promise<PdfSummary | undefined> {
  const meta = await readMeta(id);
  return meta ? toSummary(meta) : undefined;
}

/** A PDF's summary plus its extraction-quality report, for the reader page. */
export async function getPdfDetail(
  id: string,
): Promise<{ summary: PdfSummary; extraction: ExtractionReport } | undefined> {
  const meta = await readMeta(id);
  return meta ? { summary: toSummary(meta), extraction: meta.extraction } : undefined;
}

/** Extracted text for a single 1-indexed page. */
export async function getPageText(
  id: string,
  pageNumber: number,
): Promise<{ pageNumber: number; text: string; hasText: boolean } | undefined> {
  const meta = await readMeta(id);
  if (!meta) return undefined;
  try {
    const text = await fs.readFile(pageTextPath(id, pageNumber), "utf8");
    return { pageNumber, text, hasText: meta.hasText[pageNumber - 1] ?? false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Render (and cache) a single 1-indexed page of the given PDF as a PNG buffer. */
export async function renderPage(id: string, pageNumber: number): Promise<Buffer> {
  const entry = await getDocEntry(id);
  const cached = entry.pages.get(pageNumber);
  if (cached) return cached;
  const buffer = await entry.document.getPage(pageNumber);
  entry.pages.set(pageNumber, buffer);
  return buffer;
}

/** Resolve the parsed document for `id`, reparsing `source.pdf` on a cache miss. */
async function getDocEntry(id: string): Promise<DocCacheEntry> {
  const cached = docCache.get(id);
  if (cached) return cached;
  const buffer = await fs.readFile(sourcePath(id));
  const document = await pdfRender(buffer, { scale: 2 });
  const entry: DocCacheEntry = { document, pages: new Map() };
  docCache.set(id, entry);
  if (docCache.size > DOC_CACHE_LIMIT) {
    const oldest = docCache.keys().next();
    if (!oldest.done) docCache.delete(oldest.value);
  }
  return entry;
}
