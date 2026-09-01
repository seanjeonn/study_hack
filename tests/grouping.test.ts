import { describe, expect, it } from "vitest";
import { groupPdfsBySubject, subjectsOf } from "@/lib/grouping";
import type { PdfSummary } from "@/lib/schemas";

const pdf = (id: string, subject?: string): PdfSummary => ({
  id,
  filename: `${id}.pdf`,
  pageCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  subject,
});

describe("groupPdfsBySubject", () => {
  it("returns nothing for an empty list", () => {
    expect(groupPdfsBySubject([])).toEqual([]);
  });

  it("sorts subjects and always puts ungrouped last", () => {
    const groups = groupPdfsBySubject([pdf("a"), pdf("b", "자료구조"), pdf("c", "기계학습")]);
    expect(groups.map((g) => g.subject)).toEqual(["기계학습", "자료구조", ""]);
  });

  it("omits the ungrouped bucket when every PDF has a subject", () => {
    const groups = groupPdfsBySubject([pdf("a", "기계학습"), pdf("b", "기계학습")]);
    expect(groups.map((g) => g.subject)).toEqual(["기계학습"]);
  });

  it("puts an absent and an empty subject in the same bucket", () => {
    const groups = groupPdfsBySubject([pdf("a"), pdf("b", "")]);
    expect(groups).toEqual([{ subject: "", pdfs: [pdf("a"), pdf("b", "")] }]);
  });

  it("preserves the incoming order inside a group", () => {
    // listPdfs hands the list over newest-first — grouping must not reshuffle it.
    const groups = groupPdfsBySubject([
      pdf("newest", "기계학습"),
      pdf("older", "기계학습"),
      pdf("oldest", "기계학습"),
    ]);
    expect(groups[0].pdfs.map((p) => p.id)).toEqual(["newest", "older", "oldest"]);
  });
});

describe("subjectsOf", () => {
  it("dedupes, sorts, and drops the ungrouped ones", () => {
    expect(
      subjectsOf([pdf("a", "자료구조"), pdf("b"), pdf("c", "기계학습"), pdf("d", "자료구조")]),
    ).toEqual(["기계학습", "자료구조"]);
  });

  it("returns nothing when no PDF has a subject", () => {
    expect(subjectsOf([pdf("a"), pdf("b", "")])).toEqual([]);
  });
});
