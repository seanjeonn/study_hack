import { asc, eq } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "./db/client.js";
import { pdfPage } from "./db/schema.js";

// Full-context LLM probes: the entire PDF's extracted text is stuffed into a
// single prompt. This only scales to small documents — the char cap keeps the
// API from silently blowing past a model's context window. Larger PDFs need a
// retrieval (RAG) pass, which is a later slice.
export const MAX_CONTEXT_CHARS = 200_000;

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

export class LlmError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Lazily instantiated so the rest of the API (upload/viewer) keeps working
// without an OpenAI key configured; only LLM-backed routes need it.
let client: OpenAI | undefined;
export function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LlmError(503, "OPENAI_API_KEY is not configured");
  }
  client = new OpenAI({ apiKey });
  return client;
}

/**
 * Load a PDF's extracted page text and build the page-tagged context string
 * (`[p.N]\n<text>`, pages joined by a blank line) shared by every full-context
 * LLM probe (ask, quiz, ...). Throws LlmError 409 if extraction hasn't
 * produced any pages yet, or 413 if the context exceeds MAX_CONTEXT_CHARS.
 */
export async function buildPdfContext(
  pdfId: string,
): Promise<{ context: string; validPageNumbers: Set<number> }> {
  const rows = await db
    .select({ pageNumber: pdfPage.pageNumber, text: pdfPage.extractedText })
    .from(pdfPage)
    .where(eq(pdfPage.pdfId, pdfId))
    .orderBy(asc(pdfPage.pageNumber));

  if (rows.length === 0) {
    throw new LlmError(409, "page text is not ready for this PDF");
  }

  const context = rows.map((r) => `[p.${r.pageNumber}]\n${r.text}`).join("\n\n");
  if (context.length > MAX_CONTEXT_CHARS) {
    throw new LlmError(413, "PDF too large for full-context Q&A");
  }

  const validPageNumbers = new Set(rows.map((r) => r.pageNumber));
  return { context, validPageNumbers };
}
