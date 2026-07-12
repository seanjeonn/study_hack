import { and, asc, desc, eq } from "drizzle-orm";
import type { Memo, MemoListResponse, StudyLogItem, StudyLogResponse } from "@study-hack/shared";
import { db } from "./db/client.js";
import { memo, quizAttempt, quizQuestion } from "./db/schema.js";

function rowToMemo(row: typeof memo.$inferSelect): Memo {
  return {
    id: row.id,
    pdfId: row.pdfId,
    pageNumber: row.pageNumber ?? null,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Create a user-authored memo for a PDF, optionally attached to a viewer page. */
export async function createMemo(
  pdfId: string,
  content: string,
  pageNumber: number | undefined,
  userId: string,
): Promise<Memo> {
  const [row] = await db.insert(memo).values({ pdfId, content, pageNumber, userId }).returning();
  return rowToMemo(row);
}

/** All memos for a PDF, oldest first. */
export async function listMemos(pdfId: string): Promise<MemoListResponse> {
  const rows = await db
    .select()
    .from(memo)
    .where(eq(memo.pdfId, pdfId))
    .orderBy(asc(memo.createdAt));
  return { memos: rows.map(rowToMemo) };
}

/** Delete a memo, scoped to its PDF. Returns true if a row was deleted (false → 404). */
export async function deleteMemo(pdfId: string, memoId: string): Promise<boolean> {
  const deleted = await db
    .delete(memo)
    .where(and(eq(memo.id, memoId), eq(memo.pdfId, pdfId)))
    .returning({ id: memo.id });
  return deleted.length > 0;
}

/** A PDF's memo contents, oldest first — injected into /ask's context (see ask.ts). */
export async function getMemoContext(pdfId: string): Promise<string[]> {
  const rows = await db
    .select({ content: memo.content })
    .from(memo)
    .where(eq(memo.pdfId, pdfId))
    .orderBy(asc(memo.createdAt));
  return rows.map((r) => r.content);
}

/**
 * Build a PDF's study log by merging user memos with previously-missed quiz
 * questions, newest first. Wrong answers reuse the `listAttempts` join
 * pattern (quizAttempt -> quizQuestion), keeping only the latest attempt per
 * question and only questions whose latest attempt was incorrect.
 */
export async function getStudyLog(pdfId: string): Promise<StudyLogResponse> {
  const memoRows = await db.select().from(memo).where(eq(memo.pdfId, pdfId));
  const memoItems: StudyLogItem[] = memoRows.map((row) => ({
    kind: "memo",
    id: row.id,
    pageNumber: row.pageNumber ?? null,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }));

  const attemptRows = await db
    .select({
      questionId: quizQuestion.id,
      question: quizQuestion.question,
      choices: quizQuestion.choices,
      answerIndex: quizQuestion.answerIndex,
      sourcePageIds: quizQuestion.sourcePageIds,
      userAnswer: quizAttempt.userAnswer,
      isCorrect: quizAttempt.isCorrect,
      attemptCreatedAt: quizAttempt.createdAt,
    })
    .from(quizAttempt)
    .innerJoin(quizQuestion, eq(quizAttempt.quizQuestionId, quizQuestion.id))
    .where(eq(quizQuestion.pdfId, pdfId))
    .orderBy(desc(quizAttempt.createdAt));

  const latestByQuestion = new Map<string, (typeof attemptRows)[number]>();
  for (const row of attemptRows) {
    if (!latestByQuestion.has(row.questionId)) {
      latestByQuestion.set(row.questionId, row);
    }
  }

  const wrongAnswerItems: StudyLogItem[] = [...latestByQuestion.values()]
    .filter((row) => !row.isCorrect)
    .map((row) => ({
      kind: "wrong_answer",
      questionId: row.questionId,
      question: row.question,
      sourcePageIds: row.sourcePageIds,
      userAnswerText: row.choices[row.userAnswer] ?? "",
      correctAnswerText: row.choices[row.answerIndex] ?? "",
      createdAt: row.attemptCreatedAt.toISOString(),
    }));

  const items = [...memoItems, ...wrongAnswerItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return { items };
}
