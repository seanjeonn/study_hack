import "server-only";

import { getPdfSummary } from "@/lib/server/pdfStore";
import { isValidId, isValidPageNumber } from "@/lib/server/workspace";

/**
 * Resolve an `[id]` / `[n]` route pair against the workspace, distinguishing
 * each failure mode: a malformed id or page number is a 400 (this is where a
 * path-traversal attempt is stopped), a missing PDF or out-of-range page a 404.
 */
export async function resolvePage(
  id: string,
  rawPage: string,
): Promise<{ pageNumber: number } | { status: number; error: string }> {
  if (!isValidId(id)) return { status: 400, error: "invalid pdf id" };
  const summary = await getPdfSummary(id);
  if (!summary) return { status: 404, error: "pdf not found" };
  const pageNumber = Number(rawPage);
  if (!isValidPageNumber(pageNumber, summary.pageCount)) {
    return { status: 400, error: "page out of range" };
  }
  return { pageNumber };
}
