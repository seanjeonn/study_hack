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

/** Request body for `POST /pdf/:id/ask` — a question about the PDF's content. */
export const AskRequestSchema = z.object({
  question: z.string().min(1).max(2000),
});

export type AskRequest = z.infer<typeof AskRequestSchema>;

/**
 * Response for `POST /pdf/:id/ask`. `citedPages` are the 1-indexed pages the
 * answer is grounded in — the quality probe's core signal (citation accuracy
 * is measured against them). `usage` feeds the running cost measurement.
 */
export const AskResponseSchema = z.object({
  answer: z.string(),
  citedPages: z.array(z.number().int().positive()),
  model: z.string(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

export type AskResponse = z.infer<typeof AskResponseSchema>;

/** Request body for `POST /pdf/:id/quiz` — how many MCQ questions to generate. */
export const QuizGenerateRequestSchema = z.object({
  count: z.number().int().min(1).max(10).default(5),
});

export type QuizGenerateRequest = z.infer<typeof QuizGenerateRequestSchema>;

/**
 * A single generated multiple-choice question. `sourcePageIds` are the
 * 1-indexed pages the question/answer is grounded in (the citation-accuracy
 * signal, same idea as `AskResponse.citedPages`). v1 exposes `answerIndex` +
 * `explanation` to the client because grading happens client-side this slice.
 */
export const QuizQuestionSchema = z.object({
  id: z.string(),
  type: z.literal("mcq"),
  question: z.string(),
  choices: z.array(z.string()).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  sourcePageIds: z.array(z.number().int().positive()),
  difficulty: z.string(),
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

/** Response for `POST /pdf/:id/quiz`. `usage` feeds the running cost measurement. */
export const QuizGenerateResponseSchema = z.object({
  questions: z.array(QuizQuestionSchema),
  model: z.string(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

export type QuizGenerateResponse = z.infer<typeof QuizGenerateResponseSchema>;

/** Response for `GET /pdf/:id/quiz` — the previously generated questions for a PDF. */
export const QuizListResponseSchema = z.object({
  questions: z.array(QuizQuestionSchema),
});

export type QuizListResponse = z.infer<typeof QuizListResponseSchema>;
