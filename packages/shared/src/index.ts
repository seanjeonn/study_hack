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
