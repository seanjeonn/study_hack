import { describe, expect, it } from "vitest";
import { ExtractionReportSchema } from "@/lib/schemas";
import { buildExtractionReport } from "@/lib/server/meta";
import type { PageText } from "@/lib/server/textExtract";

const page = (pageNumber: number, text: string, hasText = true): PageText => ({
  pageNumber,
  text,
  hasText,
});

/** One page of clean text with a single replacement char at the end. */
const garbled = (chars: number) => `${"a".repeat(chars)}�`;

describe("buildExtractionReport", () => {
  it("reports ok for a clean document", () => {
    const report = buildExtractionReport([page(1, "a".repeat(100)), page(2, "b".repeat(200))]);
    expect(report.recommendation).toBe("ok");
    expect(report.suspectPages).toBe(0);
    expect(report.emptyPages).toBe(0);
  });

  it("treats exactly half the pages having text as ok (the threshold is a strict <)", () => {
    const report = buildExtractionReport([page(1, "a".repeat(100)), page(2, "", false)]);
    expect(report.hasTextRatio).toBe(0.5);
    expect(report.recommendation).toBe("ok");
  });

  it("recommends OCR when too few pages have text", () => {
    const report = buildExtractionReport([
      page(1, "a".repeat(100)),
      page(2, "", false),
      page(3, "", false),
    ]);
    expect(report.hasTextRatio).toBeCloseTo(1 / 3);
    expect(report.emptyPages).toBe(2);
    expect(report.recommendation).toBe("consider_ocr");
  });

  it("lets a single garbled page win over good coverage", () => {
    // 1 suspicious char in 51 non-whitespace ≈ 0.0196 > the 0.01 page threshold.
    const report = buildExtractionReport([page(1, "a".repeat(100)), page(2, garbled(50))]);
    expect(report.suspectPages).toBe(1);
    expect(report.recommendation).toBe("consider_llm_or_ocr");
  });

  it("does not flag a page just under the per-page threshold", () => {
    // 1 in 101 ≈ 0.0099 — below both the page and the document threshold.
    const report = buildExtractionReport([page(1, garbled(100))]);
    expect(report.suspectPages).toBe(0);
    expect(report.suspiciousRatio).toBeCloseTo(1 / 101);
    expect(report.recommendation).toBe("ok");
  });

  it("returns zeros and consider_ocr for no pages at all", () => {
    // Characterization: a zero-page document has a 0 text ratio, which trips
    // the scanned-PDF branch.
    expect(buildExtractionReport([])).toEqual({
      pageCount: 0,
      textPages: 0,
      emptyPages: 0,
      hasTextRatio: 0,
      totalChars: 0,
      avgCharsPerTextPage: 0,
      suspiciousChars: 0,
      suspiciousRatio: 0,
      suspectPages: 0,
      recommendation: "consider_ocr",
    });
  });

  it("averages chars over text pages only", () => {
    const report = buildExtractionReport([
      page(1, "a".repeat(300)),
      page(2, "b".repeat(100)),
      page(3, "", false),
    ]);
    expect(report.pageCount).toBe(3);
    expect(report.textPages).toBe(2);
    expect(report.totalChars).toBe(400);
    expect(report.avgCharsPerTextPage).toBe(200);
  });

  it("produces a payload the wire schema accepts", () => {
    const report = buildExtractionReport([page(1, garbled(50)), page(2, "", false)]);
    expect(() => ExtractionReportSchema.parse(report)).not.toThrow();
  });
});
