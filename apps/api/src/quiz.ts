import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type {
  QuizAttemptItem,
  QuizAttemptsResponse,
  QuizGenerateResponse,
  QuizQuestion,
  QuizSubmitResponse,
} from "@study-hack/shared";
import { db } from "./db/client.js";
import { quizAttempt, quizQuestion } from "./db/schema.js";
import { LlmError, MODEL, buildPagesContext, buildPdfContext, getClient } from "./llm.js";

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
 * Shared core of every MCQ-generation call (initial quiz + re-quiz): calls
 * the model with the given prompts and the quiz json_schema, validates +
 * defensively filters the output, and persists the kept questions. Callers
 * own their own logging and response shaping since the two call sites log
 * different fields ([quiz] vs [requiz]).
 */
async function runQuizGeneration(
  pdfId: string,
  systemPrompt: string,
  userMessage: string,
  validPageNumbers: Set<number>,
): Promise<{
  kept: z.infer<typeof ModelOutputSchema>["questions"];
  inserted: (typeof quizQuestion.$inferSelect)[];
  inputTokens: number;
  outputTokens: number;
}> {
  const openai = getClient();

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
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

  return {
    kept,
    inserted,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
}

/**
 * Generate `count` MCQ questions grounded in a PDF's full extracted text
 * (page-tagged, same full-context approach as `askPdf`), persist them, and
 * return the value satisfying QuizGenerateResponseSchema (the route parses it
 * at the boundary).
 */
export async function generateQuiz(pdfId: string, count: number): Promise<QuizGenerateResponse> {
  const { context, validPageNumbers } = await buildPdfContext(pdfId);

  const systemPrompt =
    "You are a study assistant writing multiple-choice questions about a PDF " +
    "document. The user message contains the PDF's full text, split into pages " +
    `marked [p.N]. Produce exactly ${count} questions grounded ONLY in the ` +
    "provided text. Each question has exactly 4 choices, exactly one of which " +
    "is correct (answerIndex, 0-3), an explanation of the correct answer, and " +
    "sourcePageIds — the [p.N] page numbers the question and answer are " +
    "grounded in. Never invent content or cite pages not provided. Write in the " +
    "same language as the source material.";
  const userMessage = `${context}\n\n---\nGenerate ${count} multiple-choice questions.`;

  const { kept, inserted, inputTokens, outputTokens } = await runQuizGeneration(
    pdfId,
    systemPrompt,
    userMessage,
    validPageNumbers,
  );

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

/**
 * Weakness-based re-quiz: find the questions a learner most recently
 * answered wrong, and generate NEW questions covering the same concepts
 * (from a different angle) grounded only in those questions' source pages —
 * closing the study loop without simply re-asking the same question.
 */
export async function generateRequiz(pdfId: string): Promise<QuizGenerateResponse> {
  const wrongQuestions = await listLatestWrongQuestions(pdfId);
  if (wrongQuestions.length === 0) {
    throw new LlmError(409, "no wrong answers to review");
  }

  const pages = [...new Set(wrongQuestions.flatMap((q) => q.sourcePageIds))];
  if (pages.length === 0) {
    throw new LlmError(409, "no source pages for wrong answers");
  }

  const { context, validPageNumbers } = await buildPagesContext(pdfId, pages);
  const count = Math.min(wrongQuestions.length, 5);

  const systemPrompt =
    "You are a study assistant helping a learner review concepts they answered " +
    "incorrectly. The user message contains the relevant PDF text, split into pages " +
    `marked [p.N], followed by the questions they previously missed. Write exactly ${count} ` +
    "NEW multiple-choice questions that test the SAME underlying concepts from a " +
    "DIFFERENT angle (reworded, applied, or deeper) — do NOT restate the previously " +
    "missed questions verbatim. Each question has exactly 4 choices, exactly one of " +
    "which is correct (answerIndex, 0-3), an explanation of the correct answer, and " +
    "sourcePageIds — the [p.N] page numbers the question and answer are grounded in. " +
    "Never invent content or cite pages not provided. Write in the same language as " +
    "the source material.";
  const missedList = wrongQuestions.map((q) => `- ${q.question}`).join("\n");
  const userMessage =
    `${context}\n\n---\nPreviously missed questions (do not repeat verbatim):\n${missedList}` +
    `\n\n---\nGenerate ${count} multiple-choice questions.`;

  const { kept, inserted, inputTokens, outputTokens } = await runQuizGeneration(
    pdfId,
    systemPrompt,
    userMessage,
    validPageNumbers,
  );

  console.log(
    "[requiz] " +
      JSON.stringify({
        pdfId,
        fromWrong: wrongQuestions.length,
        generated: kept.length,
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
    sourcePageIds: row.sourcePageIds,
    difficulty: row.difficulty,
  };
}

/**
 * Grade a set of submitted answers against the referenced quiz questions,
 * persist each as a `quiz_attempt` row, and return the value satisfying
 * QuizSubmitResponseSchema. Every submitted questionId must belong to `pdfId`.
 */
export async function gradeSubmission(
  pdfId: string,
  answers: { questionId: string; choiceIndex: number }[],
): Promise<QuizSubmitResponse> {
  const rows = await db
    .select()
    .from(quizQuestion)
    .where(
      inArray(
        quizQuestion.id,
        answers.map((a) => a.questionId),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const answer of answers) {
    const row = byId.get(answer.questionId);
    if (!row || row.pdfId !== pdfId) {
      throw new LlmError(400, "invalid question in submission");
    }
  }

  await db.insert(quizAttempt).values(
    answers.map((answer) => {
      const row = byId.get(answer.questionId)!;
      return {
        quizQuestionId: answer.questionId,
        userAnswer: answer.choiceIndex,
        isCorrect: answer.choiceIndex === row.answerIndex,
      };
    }),
  );

  const results = answers.map((answer) => {
    const row = byId.get(answer.questionId)!;
    return {
      questionId: answer.questionId,
      choiceIndex: answer.choiceIndex,
      correctIndex: row.answerIndex,
      isCorrect: answer.choiceIndex === row.answerIndex,
      explanation: row.explanation,
      sourcePageIds: row.sourcePageIds,
    };
  });

  const correctCount = results.filter((r) => r.isCorrect).length;
  const total = answers.length;

  console.log("[grade] " + JSON.stringify({ pdfId, total, correctCount }));

  return { results, correctCount, total };
}

/**
 * The latest attempt per question for a PDF's quiz (quizAttempt innerJoin
 * quizQuestion, filtered to pdfId), for restoring graded state on reload and
 * for finding weak spots to re-quiz. Rows are ordered by attempt recency
 * (desc) and the first one seen per question is kept.
 */
async function latestAttemptsByQuestion(pdfId: string) {
  const rows = await db
    .select({
      questionId: quizQuestion.id,
      question: quizQuestion.question,
      choices: quizQuestion.choices,
      answerIndex: quizQuestion.answerIndex,
      explanation: quizQuestion.explanation,
      sourcePageIds: quizQuestion.sourcePageIds,
      questionCreatedAt: quizQuestion.createdAt,
      userAnswer: quizAttempt.userAnswer,
      isCorrect: quizAttempt.isCorrect,
      attemptCreatedAt: quizAttempt.createdAt,
    })
    .from(quizAttempt)
    .innerJoin(quizQuestion, eq(quizAttempt.quizQuestionId, quizQuestion.id))
    .where(eq(quizQuestion.pdfId, pdfId))
    .orderBy(desc(quizAttempt.createdAt));

  const latestByQuestion = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByQuestion.has(row.questionId)) {
      latestByQuestion.set(row.questionId, row);
    }
  }
  return [...latestByQuestion.values()];
}

/**
 * The latest attempt per question for a PDF's quiz, for restoring graded
 * state on reload. Sorted by the question's creation order.
 */
export async function listAttempts(pdfId: string): Promise<QuizAttemptsResponse> {
  const latest = await latestAttemptsByQuestion(pdfId);

  const items: QuizAttemptItem[] = latest
    .sort((a, b) => a.questionCreatedAt.getTime() - b.questionCreatedAt.getTime())
    .map((row) => ({
      questionId: row.questionId,
      question: row.question,
      choices: row.choices,
      userAnswer: row.userAnswer,
      correctIndex: row.answerIndex,
      isCorrect: row.isCorrect,
      explanation: row.explanation,
      sourcePageIds: row.sourcePageIds,
    }));

  return { items };
}

/** Questions whose latest attempt for this PDF was wrong — the re-quiz's source material. */
async function listLatestWrongQuestions(
  pdfId: string,
): Promise<{ question: string; sourcePageIds: number[] }[]> {
  const latest = await latestAttemptsByQuestion(pdfId);
  return latest
    .filter((row) => !row.isCorrect)
    .map((row) => ({ question: row.question, sourcePageIds: row.sourcePageIds }));
}
