import { z } from "zod";

/**
 * Wire schemas + inferred types — the single source of truth for every HTTP
 * boundary in the app. Safe to import from client components: this module is
 * pure zod, with no node-only code (that lives in `lib/server/`).
 */
/**
 * A PDF in the workspace. `id` is the directory name (a slug derived from the
 * filename) and doubles as the URL segment. The page images themselves are
 * served as binary PNGs from `/pages/:n` (1-indexed), not in this payload.
 */
export const PdfSummarySchema = z.object({
  id: z.string(),
  filename: z.string(),
  pageCount: z.number().int().positive(),
  createdAt: z.string(),
});

export type PdfSummary = z.infer<typeof PdfSummarySchema>;

/** Response for `GET /api/pdfs` — every PDF in the workspace, newest first. */
export const PdfListResponseSchema = z.object({
  pdfs: z.array(PdfSummarySchema),
});

export type PdfListResponse = z.infer<typeof PdfListResponseSchema>;

/** Response for `GET /api/pdfs/[id]/pages/[n]/text` — a single page's extracted text. */
export const PageTextResponseSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  // false when the page has almost no extractable text (scan/image = OCR candidate).
  hasText: z.boolean(),
});

export type PageTextResponse = z.infer<typeof PageTextResponseSchema>;

/**
 * Data-driven recommendation derived from extraction metrics:
 * - `ok`: text coverage looks usable.
 * - `consider_ocr`: too many pages have no text (likely scanned/image PDF).
 * - `consider_llm_or_ocr`: text exists but is heavily garbled (encoding/font
 *   mapping failure), so OCR or an LLM-based extraction pass is worth considering.
 */
export const ExtractionRecommendationSchema = z.enum(["ok", "consider_ocr", "consider_llm_or_ocr"]);

export type ExtractionRecommendation = z.infer<typeof ExtractionRecommendationSchema>;

/**
 * Response for `GET /api/pdfs/[id]` — an objective quality gauge for
 * extracted text so the OCR-vs-LLM decision is made from data, not vibes. Ratios
 * are in 0..1. Semantic correctness is NOT captured here (needs human review).
 */
export const ExtractionReportSchema = z.object({
  pageCount: z.number().int().nonnegative(),
  textPages: z.number().int().nonnegative(),
  emptyPages: z.number().int().nonnegative(),
  hasTextRatio: z.number().min(0).max(1),
  totalChars: z.number().int().nonnegative(),
  avgCharsPerTextPage: z.number().nonnegative(),
  // "Suspicious" chars are corruption markers (controls, broken-CID symbols,
  // replacement/Specials). suspectPages = pages whose suspicious ratio is high
  // enough to look genuinely garbled (localized garble that a global ratio
  // would dilute away).
  suspiciousChars: z.number().int().nonnegative(),
  suspiciousRatio: z.number().min(0).max(1),
  suspectPages: z.number().int().nonnegative(),
  recommendation: ExtractionRecommendationSchema,
});

export type ExtractionReport = z.infer<typeof ExtractionReportSchema>;

/**
 * One entry in a page's note. `id` is the entry's timestamp heading, which is
 * also its identity on disk. An empty `id` is the preamble: text that sits
 * above the first timestamp heading, which is how a hand-written or older flat
 * note file reads.
 */
export const NoteEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
});

export type NoteEntry = z.infer<typeof NoteEntrySchema>;

/**
 * Response for the page-note routes — the page's note as its accumulated
 * entries, oldest first. An empty array means the page has no note file yet.
 */
export const PageNoteResponseSchema = z.object({
  pageNumber: z.number().int().positive(),
  entries: z.array(NoteEntrySchema),
});

export type PageNoteResponse = z.infer<typeof PageNoteResponseSchema>;

/** Request body for `POST /api/pdfs/[id]/pages/[n]/note` — append one entry. */
export const NoteEntryCreateRequestSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
});

export type NoteEntryCreateRequest = z.infer<typeof NoteEntryCreateRequestSchema>;

/** Request body for `PUT /api/pdfs/[id]/pages/[n]/note` — edit one entry in place. */
export const NoteEntryUpdateRequestSchema = z.object({
  entryId: z.string(),
  content: z.string().trim().min(1).max(100_000),
});

export type NoteEntryUpdateRequest = z.infer<typeof NoteEntryUpdateRequestSchema>;

/** Response for `GET /api/pdfs/[id]` — a PDF's summary plus its extraction report. */
export const PdfDetailResponseSchema = z.object({
  summary: PdfSummarySchema,
  extraction: ExtractionReportSchema,
});

export type PdfDetailResponse = z.infer<typeof PdfDetailResponseSchema>;

/**
 * Response for the AI page-note routes — the whole accumulated markdown file
 * for one page. Sections are append-only, so this grows by one `##` block per
 * generation and older sections are never rewritten.
 */
export const AiNoteResponseSchema = z.object({
  pageNumber: z.number().int().positive(),
  content: z.string(),
});

export type AiNoteResponse = z.infer<typeof AiNoteResponseSchema>;

/** A place a concept appears: a PDF id and the 1-indexed pages it shows up on. */
export const ConceptSourceSchema = z.object({
  pdf: z.string(),
  pages: z.array(z.number().int().positive()),
});

export type ConceptSource = z.infer<typeof ConceptSourceSchema>;

/** Response for `GET /api/concepts/[slug]` — one concept, body included. */
export const ConceptResponseSchema = z.object({
  slug: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  sources: z.array(ConceptSourceSchema),
  related: z.array(z.string()),
  updated: z.string(),
  body: z.string(),
});

export type ConceptResponse = z.infer<typeof ConceptResponseSchema>;

/**
 * Response for `GET /api/concepts/graph`. Edges are undirected pairs, already
 * deduped and stripped of any that point at a concept file that no longer
 * exists.
 */
export const ConceptGraphResponseSchema = z.object({
  nodes: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      /** How many distinct PDFs mention the concept — its cross-PDF weight. */
      pdfCount: z.number().int().nonnegative(),
    }),
  ),
  edges: z.array(z.object({ source: z.string(), target: z.string() })),
});

export type ConceptGraphResponse = z.infer<typeof ConceptGraphResponseSchema>;

/**
 * Response for `POST /api/concepts/refresh`. `llmCalls` is reported so the
 * cost of a refresh is visible rather than hidden.
 */
export const ConceptRefreshResponseSchema = z.object({
  scannedPdfs: z.number().int().nonnegative(),
  skippedPdfs: z.number().int().nonnegative(),
  llmCalls: z.number().int().nonnegative(),
  conceptsCreated: z.number().int().nonnegative(),
  conceptsUpdated: z.number().int().nonnegative(),
});

export type ConceptRefreshResponse = z.infer<typeof ConceptRefreshResponseSchema>;
