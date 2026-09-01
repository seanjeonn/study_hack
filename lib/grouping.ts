import type { PdfSummary } from "@/lib/schemas";

/**
 * Grouping PDFs by subject for the library and the sidebar. Pure and
 * client-safe: no node-only code, no fetching — the subject already rides along
 * on every `PdfSummary`.
 */
export interface PdfGroup {
  /** The subject, or "" for the ungrouped bucket. */
  subject: string;
  pdfs: PdfSummary[];
}

/**
 * Group PDFs by subject, subjects sorted and the ungrouped bucket always last
 * (omitted when empty). Order inside a group is the caller's — the list comes
 * in newest-first and stays that way.
 */
export function groupPdfsBySubject(pdfs: PdfSummary[]): PdfGroup[] {
  const bySubject = new Map<string, PdfSummary[]>();
  for (const pdf of pdfs) {
    const subject = pdf.subject ?? "";
    const group = bySubject.get(subject);
    if (group) group.push(pdf);
    else bySubject.set(subject, [pdf]);
  }
  const groups = [...bySubject.entries()]
    .filter(([subject]) => subject !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subject, groupPdfs]) => ({ subject, pdfs: groupPdfs }));
  const ungrouped = bySubject.get("");
  if (ungrouped) groups.push({ subject: "", pdfs: ungrouped });
  return groups;
}

/** Every subject in use, deduped and sorted — the source for every subject picker. */
export function subjectsOf(pdfs: PdfSummary[]): string[] {
  const subjects = new Set<string>();
  for (const pdf of pdfs) {
    if (pdf.subject) subjects.add(pdf.subject);
  }
  return [...subjects].sort((a, b) => a.localeCompare(b));
}
