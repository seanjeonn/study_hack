import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import OpenAI from "openai";
import type { AskResponse } from "@study-hack/shared";
import { db } from "./db/client.js";
import { pdfPage } from "./db/schema.js";

// Full-context Q&A probe: the entire PDF's extracted text is stuffed into a
// single prompt. This only scales to small documents — the char cap keeps the
// API from silently blowing past a model's context window. Larger PDFs need a
// retrieval (RAG) pass, which is a later slice.
const MAX_CONTEXT_CHARS = 200_000;

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

export class AskError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Lazily instantiated so the rest of the API (upload/viewer) keeps working
// without an OpenAI key configured; only the /ask route needs it.
let client: OpenAI | undefined;
function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AskError(503, "OPENAI_API_KEY is not configured");
  }
  client = new OpenAI({ apiKey });
  return client;
}

/** Shape the model is instructed (via json_schema) to return — validated before use. */
const ModelOutputSchema = z.object({
  answer: z.string(),
  citedPages: z.array(z.number().int()),
});

/**
 * Answer a question about a PDF by sending its full extracted text to the
 * model, page-tagged so the answer can cite grounding pages. The returned
 * value satisfies AskResponseSchema; the route parses it at the boundary.
 */
export async function askPdf(pdfId: string, question: string): Promise<AskResponse> {
  const rows = await db
    .select({ pageNumber: pdfPage.pageNumber, text: pdfPage.extractedText })
    .from(pdfPage)
    .where(eq(pdfPage.pdfId, pdfId))
    .orderBy(asc(pdfPage.pageNumber));

  if (rows.length === 0) {
    throw new AskError(409, "page text is not ready for this PDF");
  }

  const context = rows.map((r) => `[p.${r.pageNumber}]\n${r.text}`).join("\n\n");
  if (context.length > MAX_CONTEXT_CHARS) {
    throw new AskError(413, "PDF too large for full-context Q&A");
  }

  const validPageNumbers = new Set(rows.map((r) => r.pageNumber));
  const openai = getClient();

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a study assistant answering questions about a PDF document. " +
          "The user message contains the PDF's full text, split into pages marked " +
          "[p.N]. Answer in the same language as the question. Base your answer " +
          "ONLY on the provided pages and cite the grounding page numbers in " +
          "citedPages. If the answer is not contained in the pages, say so plainly " +
          "and return an empty citedPages array — never invent content or citations.",
      },
      {
        role: "user",
        content: `${context}\n\n---\nQuestion: ${question}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ask_answer",
        strict: true,
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            citedPages: { type: "array", items: { type: "integer" } },
          },
          required: ["answer", "citedPages"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = completion.choices[0]?.message.content;
  if (!content) {
    throw new AskError(502, "empty response from the model");
  }

  const parsed = ModelOutputSchema.parse(JSON.parse(content));
  // Dedupe citations and drop any page the document doesn't actually have.
  const citedPages = [...new Set(parsed.citedPages)]
    .filter((n) => validPageNumbers.has(n))
    .sort((a, b) => a - b);

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;

  // One JSON line per ask, feeding the citation-accuracy + cost measurement
  // routine (a cross-cutting concern of this quality-probe slice).
  console.log(
    "[ask] " +
      JSON.stringify({ pdfId, question, citedPages, model: MODEL, inputTokens, outputTokens }),
  );

  return {
    answer: parsed.answer,
    citedPages,
    model: MODEL,
    usage: { inputTokens, outputTokens },
  };
}
