import { and, eq } from "drizzle-orm";
import { pdf as pdfRender } from "pdf-to-img";
import type { ExtractionRecommendation, ExtractionReport } from "@study-hack/shared";
import { db } from "./db/client.js";
import { pdf, pdfPage } from "./db/schema.js";
import { countSuspiciousChars, extractPdfText } from "./textExtract.js";

// Thresholds for the extraction-quality recommendation. Tuned against real
// course PDFs (clean English/math decks vs. one with garbled CID text) — they
// decide when to fall back to OCR or an LLM extraction pass.
const MIN_HAS_TEXT_RATIO = 0.5; // below this, the PDF is likely scanned/image-only
const MAX_SUSPICIOUS_RATIO = 0.02; // overall corruption-char ratio that looks bad
const PAGE_SUSPICIOUS_RATIO = 0.01; // a page above this (of non-whitespace) looks garbled

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
  // Kick off text extraction in the background — the upload response must not
  // wait on it. Status transitions (processing -> text_ready/failed) and errors
  // are handled inside runTextExtraction.
  void runTextExtraction(row.id, buffer);
  return { id: row.id, pageCount, filename };
}

/**
 * Background job: extract per-page text, persist it to `pdf_page`, and advance
 * `pdf.status`. Fire-and-forget — failures land in `status='failed'` + a log.
 */
async function runTextExtraction(id: string, buffer: Buffer): Promise<void> {
  try {
    await db.update(pdf).set({ status: "processing" }).where(eq(pdf.id, id));
    const pages = await extractPdfText(buffer);
    if (pages.length > 0) {
      await db.insert(pdfPage).values(
        pages.map((p) => ({
          pdfId: id,
          pageNumber: p.pageNumber,
          extractedText: p.text,
          hasText: p.hasText,
        })),
      );
    }
    await db.update(pdf).set({ status: "text_ready" }).where(eq(pdf.id, id));
    // Log the quality report so extraction performance accumulates during dev.
    const report = await getExtractionReport(id);
    console.info(`[extract] pdf=${id} report=${JSON.stringify(report)}`);
  } catch (err) {
    console.error(`[extract] pdf=${id} failed:`, err);
    await db
      .update(pdf)
      .set({ status: "failed" })
      .where(eq(pdf.id, id))
      .catch(() => {});
  }
}

/** PDF metadata + processing status, for the web client's progress polling. */
export async function getPdfStatus(
  id: string,
): Promise<{ id: string; filename: string; pageCount: number; status: string } | undefined> {
  const [row] = await db
    .select({
      id: pdf.id,
      filename: pdf.filename,
      pageCount: pdf.pageCount,
      status: pdf.status,
    })
    .from(pdf)
    .where(eq(pdf.id, id))
    .limit(1);
  return row;
}

/** Extracted text for a single 1-indexed page, if it has been extracted yet. */
export async function getPageText(
  id: string,
  pageNumber: number,
): Promise<{ pageNumber: number; text: string; hasText: boolean } | undefined> {
  const [row] = await db
    .select({
      pageNumber: pdfPage.pageNumber,
      text: pdfPage.extractedText,
      hasText: pdfPage.hasText,
    })
    .from(pdfPage)
    .where(and(eq(pdfPage.pdfId, id), eq(pdfPage.pageNumber, pageNumber)))
    .limit(1);
  return row;
}

/**
 * Aggregate extraction-quality metrics for a PDF from its `pdf_page` rows. Page
 * texts are scanned in app code (not SQL) so per-page suspicious ratios can be
 * computed — localized garble that a document-wide ratio would dilute away. The
 * recommendation is a threshold-based gauge of whether OCR/LLM fallback is worth
 * considering. Returns undefined if the PDF does not exist.
 */
export async function getExtractionReport(id: string): Promise<ExtractionReport | undefined> {
  const [meta] = await db
    .select({ pageCount: pdf.pageCount })
    .from(pdf)
    .where(eq(pdf.id, id))
    .limit(1);
  if (!meta) return undefined;

  const rows = await db
    .select({ text: pdfPage.extractedText, hasText: pdfPage.hasText })
    .from(pdfPage)
    .where(eq(pdfPage.pdfId, id));

  const pageCount = meta.pageCount;
  let textPages = 0;
  let totalChars = 0;
  let suspiciousChars = 0;
  let suspectPages = 0;
  for (const row of rows) {
    if (row.hasText) textPages++;
    totalChars += row.text.length;
    const susp = countSuspiciousChars(row.text);
    suspiciousChars += susp;
    const nonWhitespace = row.text.replace(/\s/g, "").length;
    if (nonWhitespace > 0 && susp / nonWhitespace > PAGE_SUSPICIOUS_RATIO) suspectPages++;
  }

  const emptyPages = Math.max(pageCount - textPages, 0);
  const hasTextRatio = pageCount > 0 ? textPages / pageCount : 0;
  const suspiciousRatio = totalChars > 0 ? suspiciousChars / totalChars : 0;
  const avgCharsPerTextPage = textPages > 0 ? totalChars / textPages : 0;

  let recommendation: ExtractionRecommendation = "ok";
  if (suspectPages > 0 || suspiciousRatio > MAX_SUSPICIOUS_RATIO) {
    // Text exists but is garbled on at least one page — OCR or an LLM pass.
    recommendation = "consider_llm_or_ocr";
  } else if (hasTextRatio < MIN_HAS_TEXT_RATIO) {
    // Too few pages have text — likely a scanned/image PDF.
    recommendation = "consider_ocr";
  }

  return {
    pageCount,
    textPages,
    emptyPages,
    hasTextRatio,
    totalChars,
    avgCharsPerTextPage,
    suspiciousChars,
    suspiciousRatio,
    suspectPages,
    recommendation,
  };
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
