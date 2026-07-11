import { z } from "zod";
import type { AskResponse } from "@study-hack/shared";
import { LlmError, MODEL, buildPdfContext, getClient } from "./llm.js";

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
  const { context, validPageNumbers } = await buildPdfContext(pdfId);
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
    throw new LlmError(502, "empty response from the model");
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
