import { and, asc, eq } from "drizzle-orm";
import type { Memo, MemoListResponse, StudyLogItem, StudyLogResponse } from "@study-hack/shared";
import { db } from "./db/client.js";
import { memo } from "./db/schema.js";

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
  pageNumber?: number,
): Promise<Memo> {
  const [row] = await db.insert(memo).values({ pdfId, content, pageNumber }).returning();
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

/** Build a PDF's study log from the user's memos, newest first. */
export async function getStudyLog(pdfId: string): Promise<StudyLogResponse> {
  const memoRows = await db.select().from(memo).where(eq(memo.pdfId, pdfId));
  const items: StudyLogItem[] = memoRows
    .map((row) => ({
      kind: "memo" as const,
      id: row.id,
      pageNumber: row.pageNumber ?? null,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { items };
}
