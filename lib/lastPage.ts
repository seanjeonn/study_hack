/**
 * The last page the reader was on, per PDF, kept in localStorage — a browser
 * convenience, not workspace data, so nothing here touches a file or an API.
 * Safe to import from client components: no node-only code.
 *
 * One key per PDF holding a decimal string ("7"). Anything else is treated as
 * absent. The page is NOT clamped to the PDF's length here — `PdfReader`
 * already clamps `?page`, so a stale value degrades to the last page.
 */
const PREFIX = "study_hack:last-page:";

export function lastPageKey(pdfId: string): string {
  return `${PREFIX}${pdfId}`;
}

export function parseLastPage(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw);
}

export function readLastPage(pdfId: string): number | null {
  try {
    return parseLastPage(window.localStorage.getItem(lastPageKey(pdfId)));
  } catch {
    // Storage can be disabled entirely — that is not an error state here.
    return null;
  }
}

export function rememberLastPage(pdfId: string, page: number): void {
  try {
    window.localStorage.setItem(lastPageKey(pdfId), String(page));
  } catch {
    // Ignore: remembering the page is a convenience, never a requirement.
  }
}
