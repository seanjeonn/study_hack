import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ExtractionReportSchema, type ExtractionReport } from "@/lib/schemas";
import { countSuspiciousChars, extractPdfText, type PageText } from "@/lib/server/textExtract";
import { atomicWrite, cacheDir, metaPath, pageTextPath, sourcePath } from "@/lib/server/workspace";

// Thresholds for the extraction-quality recommendation. Tuned against real
// course PDFs (clean English/math decks vs. one with garbled CID text) — they
// decide when to fall back to OCR or an LLM extraction pass.
const MIN_HAS_TEXT_RATIO = 0.5; // below this, the PDF is likely scanned/image-only
const MAX_SUSPICIOUS_RATIO = 0.02; // overall corruption-char ratio that looks bad
const PAGE_SUSPICIOUS_RATIO = 0.01; // a page above this (of non-whitespace) looks garbled

/**
 * `.cache/meta.json` — the app's own index of a PDF directory. It is derived
 * data: if it is missing or a user has corrupted it, it is rebuilt from
 * `source.pdf`, which is what makes dropping a PDF into the workspace by hand
 * work.
 */
export const PdfMetaSchema = z.object({
  id: z.string(),
  filename: z.string(),
  pageCount: z.number().int().positive(),
  createdAt: z.string(),
  /** Per-page "has extractable text" flags, index 0 = page 1. */
  hasText: z.array(z.boolean()),
  extraction: ExtractionReportSchema,
  /** Set by the concept refresh so an unchanged PDF is not re-scanned. */
  conceptFingerprint: z.string().optional(),
  conceptRefreshedAt: z.string().optional(),
});

export type PdfMeta = z.infer<typeof PdfMetaSchema>;

/**
 * Aggregate extraction-quality metrics for a PDF from its page texts. Per-page
 * suspicious ratios are computed separately from the document-wide one so
 * localized garble is not diluted away. The recommendation is a threshold-based
 * gauge of whether an OCR/LLM fallback is worth considering.
 */
export function buildExtractionReport(pages: PageText[]): ExtractionReport {
  const pageCount = pages.length;
  let textPages = 0;
  let totalChars = 0;
  let suspiciousChars = 0;
  let suspectPages = 0;
  for (const page of pages) {
    if (page.hasText) textPages++;
    totalChars += page.text.length;
    const susp = countSuspiciousChars(page.text);
    suspiciousChars += susp;
    const nonWhitespace = page.text.replace(/\s/g, "").length;
    if (nonWhitespace > 0 && susp / nonWhitespace > PAGE_SUSPICIOUS_RATIO) suspectPages++;
  }

  const emptyPages = Math.max(pageCount - textPages, 0);
  const hasTextRatio = pageCount > 0 ? textPages / pageCount : 0;
  const suspiciousRatio = totalChars > 0 ? suspiciousChars / totalChars : 0;
  const avgCharsPerTextPage = textPages > 0 ? totalChars / textPages : 0;

  let recommendation: ExtractionReport["recommendation"] = "ok";
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
 * Extract a PDF's text, write one `.cache/text/page-NNN.txt` per page, and
 * write `.cache/meta.json`. This is the single indexing path — used both by a
 * fresh upload and by the rebuild of a directory whose cache went missing.
 */
export async function indexPdf(
  id: string,
  buffer: Buffer,
  filename: string,
  createdAt: string,
): Promise<PdfMeta> {
  const pages = await extractPdfText(buffer);
  if (pages.length === 0) throw new Error("the PDF has no pages");

  await fs.mkdir(path.join(cacheDir(id), "text"), { recursive: true });
  for (const page of pages) {
    await atomicWrite(pageTextPath(id, page.pageNumber), page.text);
  }

  const meta: PdfMeta = {
    id,
    filename,
    pageCount: pages.length,
    createdAt,
    hasText: pages.map((p) => p.hasText),
    extraction: buildExtractionReport(pages),
  };
  await writeMeta(meta);
  return meta;
}

export async function writeMeta(meta: PdfMeta): Promise<void> {
  await atomicWrite(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

/**
 * Read a PDF's meta, rebuilding it from `source.pdf` when it is absent or
 * fails validation — the cache is app-owned and disposable, so a corrupted or
 * hand-deleted `.cache/` must never be fatal. Returns undefined only when the
 * directory holds no readable `source.pdf`.
 */
export async function readMeta(id: string): Promise<PdfMeta | undefined> {
  try {
    const raw = await fs.readFile(metaPath(id), "utf8");
    const parsed = PdfMetaSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    console.warn(`[meta] pdf=${id} meta.json is invalid — rebuilding`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[meta] pdf=${id} meta.json is unreadable — rebuilding:`, err);
    }
  }

  let buffer: Buffer;
  let createdAt: string;
  try {
    buffer = await fs.readFile(sourcePath(id));
    createdAt = (await fs.stat(sourcePath(id))).mtime.toISOString();
  } catch {
    return undefined;
  }
  try {
    // The original filename only lived in meta.json, so a rebuild falls back
    // to the directory name.
    return await indexPdf(id, buffer, `${id}.pdf`, createdAt);
  } catch (err) {
    console.warn(`[meta] pdf=${id} rebuild failed:`, err);
    return undefined;
  }
}
