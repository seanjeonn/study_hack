import { eq } from "drizzle-orm";
import { pdf as pdfRender } from "pdf-to-img";
import { db } from "./db/client.js";
import { pdf } from "./db/schema.js";

type PdfDocument = Awaited<ReturnType<typeof pdfRender>>;

interface DocCacheEntry {
  document: PdfDocument;
  /** Lazily-rendered PNG buffers, keyed by 1-indexed page number. */
  pages: Map<number, Buffer>;
}

/**
 * Process-local cache of parsed PDF documents and their rendered page images.
 * The durable record (original bytes + metadata) lives in Postgres; this cache
 * only holds the non-serializable `pdf-to-img` document and the rendered PNGs,
 * both of which are cheap to rebuild from the stored bytes after a restart.
 */
const docCache = new Map<string, DocCacheEntry>();

export async function addPdf(
  buffer: Buffer,
  filename: string,
): Promise<{ id: string; pageCount: number; filename: string }> {
  // Parses the PDF (lazy) and exposes page count without rendering any page yet.
  const document = await pdfRender(buffer, { scale: 2 });
  const pageCount = document.length;
  const [row] = await db
    .insert(pdf)
    .values({ filename, pageCount, bytes: buffer })
    .returning({ id: pdf.id });
  docCache.set(row.id, { document, pages: new Map() });
  return { id: row.id, pageCount, filename };
}

/**
 * Look up a PDF's metadata for existence + page-range checks. Deliberately does
 * not read the (large) `bytes` column — that is only loaded on a render miss.
 */
export async function getPdf(id: string): Promise<{ pageCount: number } | undefined> {
  const [row] = await db
    .select({ pageCount: pdf.pageCount })
    .from(pdf)
    .where(eq(pdf.id, id))
    .limit(1);
  return row;
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

/**
 * Resolve the parsed document for `id`, reconstructing it from the stored bytes
 * on a cache miss (e.g. the first request after a restart).
 */
async function getDocEntry(id: string): Promise<DocCacheEntry> {
  const cached = docCache.get(id);
  if (cached) return cached;
  const [row] = await db.select({ bytes: pdf.bytes }).from(pdf).where(eq(pdf.id, id)).limit(1);
  if (!row) throw new Error(`pdf ${id} not found`);
  const document = await pdfRender(row.bytes, { scale: 2 });
  const entry: DocCacheEntry = { document, pages: new Map() };
  docCache.set(id, entry);
  return entry;
}
