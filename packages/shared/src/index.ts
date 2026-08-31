import { z } from "zod";

/**
 * Shared zod schemas + inferred types — the single source of truth (SSOT)
 * consumed by both `apps/web` and `apps/api`.
 */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Response returned by `POST /pdf` after a PDF is uploaded and parsed.
 * The page images themselves are served as binary PNGs from
 * `GET /pdf/:id/pages/:n` (1-indexed) and are not part of this JSON payload.
 */
export const PdfUploadResponseSchema = z.object({
  id: z.string(),
  pageCount: z.number().int().positive(),
  filename: z.string(),
});

export type PdfUploadResponse = z.infer<typeof PdfUploadResponseSchema>;

/**
 * Processing lifecycle of an uploaded PDF. `uploaded` is the initial state set
 * on insert; text extraction runs in the background and moves it through
 * `processing` to `text_ready` (or `failed`).
 */
export const PdfStatusSchema = z.enum(["uploaded", "processing", "text_ready", "failed"]);

export type PdfStatus = z.infer<typeof PdfStatusSchema>;

/** Response for `GET /pdf/:id` — used by the web client to poll extraction progress. */
export const PdfStatusResponseSchema = z.object({
  id: z.string(),
  filename: z.string(),
  pageCount: z.number().int().positive(),
  status: PdfStatusSchema,
});

export type PdfStatusResponse = z.infer<typeof PdfStatusResponseSchema>;

/** Response for `GET /pdf/:id/pages/:n/text` — a single page's extracted text. */
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
 * Response for `GET /pdf/:id/extraction-report` — an objective quality gauge for
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

/** Request body for `POST /pdf/:id/memos` — a user-authored study note. */
export const MemoCreateRequestSchema = z.object({
  content: z.string().min(1).max(4000),
  pageNumber: z.number().int().positive().optional(),
});

export type MemoCreateRequest = z.infer<typeof MemoCreateRequestSchema>;

/** A single user-authored memo attached to a PDF (optionally to one page). */
export const MemoSchema = z.object({
  id: z.string(),
  pdfId: z.string(),
  pageNumber: z.number().int().positive().nullable(),
  content: z.string(),
  createdAt: z.string(),
});

export type Memo = z.infer<typeof MemoSchema>;

/** Response for `GET /pdf/:id/memos` — all memos for a PDF. */
export const MemoListResponseSchema = z.object({
  memos: z.array(MemoSchema),
});

export type MemoListResponse = z.infer<typeof MemoListResponseSchema>;

/** A single item in a PDF's study log — a user-authored memo. */
export const StudyLogItemSchema = z.object({
  kind: z.literal("memo"),
  id: z.string(),
  pageNumber: z.number().int().positive().nullable(),
  content: z.string(),
  createdAt: z.string(),
});

export type StudyLogItem = z.infer<typeof StudyLogItemSchema>;

/** Response for `GET /pdf/:id/study-log` — the PDF's memos, newest first. */
export const StudyLogResponseSchema = z.object({
  items: z.array(StudyLogItemSchema),
});

export type StudyLogResponse = z.infer<typeof StudyLogResponseSchema>;
