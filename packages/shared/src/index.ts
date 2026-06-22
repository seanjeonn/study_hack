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
 * Processing stage of an uploaded PDF, stored in `pdf.status`.
 * `uploaded` → `processing` → `text_ready` | `failed`.
 */
export const PdfStatusSchema = z.enum(["uploaded", "processing", "text_ready", "failed"]);

export type PdfStatus = z.infer<typeof PdfStatusSchema>;

/**
 * Response for `GET /pdf/:id/status` — lets the client poll extraction progress.
 * `pagesExtracted` counts how many `pdf_page` rows exist so far.
 */
export const PdfStatusResponseSchema = z.object({
  id: z.string(),
  status: PdfStatusSchema,
  pageCount: z.number().int().positive(),
  pagesExtracted: z.number().int().nonnegative(),
});

export type PdfStatusResponse = z.infer<typeof PdfStatusResponseSchema>;

/**
 * Per-page extracted content, returned by `GET /pdf/:id/pages/:n/text`.
 * `content` is the merged result (vision transcription, falling back to the raw
 * text layer); `textLayerText` is the pristine pdfjs output kept for reference.
 */
export const PdfPageTextSchema = z.object({
  pageNumber: z.number().int().positive(),
  hasText: z.boolean(),
  visionUsed: z.boolean(),
  content: z.string(),
  textLayerText: z.string(),
});

export type PdfPageText = z.infer<typeof PdfPageTextSchema>;
