import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { QuizGenerateResponse, QuizQuestion } from "@study-hack/shared";
import { db } from "./db/client.js";
import { quizQuestion } from "./db/schema.js";
import { LlmError, MODEL, buildPdfContext, getClient } from "./llm.js";

/** Shape the model is instructed (via json_schema) to return — validated before use. */
const ModelOutputSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      choices: z.array(z.string()),
      answerIndex: z.number().int(),
      explanation: z.string(),
      sourcePageIds: z.array(z.number().int()),
    }),
  ),
});

/**
 * Generate `count` MCQ questions grounded in a PDF's full extracted text
 * (page-tagged, same full-context approach as `askPdf`), persist them, and
 * return the value satisfying QuizGenerateResponseSchema (the route parses it
 * at the boundary).
 */
export async function generateQuiz(pdfId: string, count: number): Promise<QuizGenerateResponse> {
  const { context, validPageNumbers } = await buildPdfContext(pdfId);
  const openai = getClient();

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a study assistant writing multiple-choice questions about a PDF " +
          "document. The user message contains the PDF's full text, split into pages " +
          `marked [p.N]. Produce exactly ${count} questions grounded ONLY in the ` +
          "provided text. Each question has exactly 4 choices, exactly one of which " +
          "is correct (answerIndex, 0-3), an explanation of the correct answer, and " +
          "sourcePageIds — the [p.N] page numbers the question and answer are " +
          "grounded in. Never invent content or cite pages not provided. Write in the " +
          "same language as the source material.",
      },
      {
        role: "user",
        content: `${context}\n\n---\nGenerate ${count} multiple-choice questions.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "quiz",
        strict: true,
        schema: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  choices: { type: "array", items: { type: "string" } },
                  answerIndex: { type: "integer" },
                  explanation: { type: "string" },
                  sourcePageIds: { type: "array", items: { type: "integer" } },
                },
                required: ["question", "choices", "answerIndex", "explanation", "sourcePageIds"],
                additionalProperties: false,
              },
            },
          },
          required: ["questions"],
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

  // Defensively drop malformed questions (strict json_schema can't express
  // choices.length === 4), and ground sourcePageIds to real pages only.
  const kept = parsed.questions
    .filter((q) => q.choices.length === 4 && q.answerIndex >= 0 && q.answerIndex <= 3)
    .map((q) => ({
      ...q,
      sourcePageIds: [...new Set(q.sourcePageIds)]
        .filter((n) => validPageNumbers.has(n))
        .sort((a, b) => a - b),
    }));

  const inserted =
    kept.length > 0
      ? await db
          .insert(quizQuestion)
          .values(
            kept.map((q) => ({
              pdfId,
              type: "mcq",
              question: q.question,
              choices: q.choices,
              answerIndex: q.answerIndex,
              explanation: q.explanation,
              sourcePageIds: q.sourcePageIds,
              difficulty: "medium",
            })),
          )
          .returning()
      : [];

  const inputTokens = completion.usage?.prompt_tokens ?? 0;
  const outputTokens = completion.usage?.completion_tokens ?? 0;

  // One JSON line per generation, feeding the citation-accuracy + cost
  // measurement routine (same cross-cutting concern as [ask]).
  console.log(
    "[quiz] " +
      JSON.stringify({
        pdfId,
        count: kept.length,
        sourcePageIds: kept.map((q) => q.sourcePageIds),
        model: MODEL,
        inputTokens,
        outputTokens,
      }),
  );

  return {
    questions: inserted.map(rowToQuizQuestion),
    model: MODEL,
    usage: { inputTokens, outputTokens },
  };
}

/** Previously generated questions for a PDF, in generation order. */
export async function listQuiz(pdfId: string): Promise<{ questions: QuizQuestion[] }> {
  const rows = await db
    .select()
    .from(quizQuestion)
    .where(eq(quizQuestion.pdfId, pdfId))
    .orderBy(asc(quizQuestion.createdAt));
  return { questions: rows.map(rowToQuizQuestion) };
}

function rowToQuizQuestion(row: typeof quizQuestion.$inferSelect): QuizQuestion {
  return {
    id: row.id,
    type: "mcq",
    question: row.question,
    choices: row.choices,
    answerIndex: row.answerIndex,
    explanation: row.explanation,
    sourcePageIds: row.sourcePageIds,
    difficulty: row.difficulty,
  };
}
