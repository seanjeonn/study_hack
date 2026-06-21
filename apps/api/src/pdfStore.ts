import { randomUUID } from "node:crypto";
import { pdf } from "pdf-to-img";

type PdfDocument = Awaited<ReturnType<typeof pdf>>;

interface PdfEntry {
  document: PdfDocument;
  pageCount: number;
  filename: string;
  /** Lazily-rendered PNG buffers, keyed by 1-indexed page number. */
  pages: Map<number, Buffer>;
}

/**
 * In-memory store of uploaded PDFs. Volatile by design (cleared on restart) —
 * durable storage (disk/DB/object store) is intentionally out of scope for the MVP.
 */
const store = new Map<string, PdfEntry>();

export async function addPdf(
  buffer: Buffer,
  filename: string,
): Promise<{ id: string; pageCount: number; filename: string }> {
  // Parses the PDF (lazy) and exposes page count without rendering any page yet.
  const document = await pdf(buffer, { scale: 2 });
  const id = randomUUID();
  store.set(id, { document, pageCount: document.length, filename, pages: new Map() });
  return { id, pageCount: document.length, filename };
}

export function getEntry(id: string): PdfEntry | undefined {
  return store.get(id);
}

/** Render (and cache) a single 1-indexed page as a PNG buffer. */
export async function renderPage(entry: PdfEntry, pageNumber: number): Promise<Buffer> {
  const cached = entry.pages.get(pageNumber);
  if (cached) return cached;
  const buffer = await entry.document.getPage(pageNumber);
  entry.pages.set(pageNumber, buffer);
  return buffer;
}
