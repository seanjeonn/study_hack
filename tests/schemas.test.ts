import { describe, expect, it } from "vitest";
import {
  ConceptRefreshResponseSchema,
  ExtractionReportSchema,
  NoteEntryCreateRequestSchema,
  NoteEntryUpdateRequestSchema,
  PdfSummarySchema,
} from "@/lib/schemas";

const report = {
  pageCount: 2,
  textPages: 2,
  emptyPages: 0,
  hasTextRatio: 1,
  totalChars: 100,
  avgCharsPerTextPage: 50,
  suspiciousChars: 0,
  suspiciousRatio: 0,
  suspectPages: 0,
  recommendation: "ok",
};

describe("NoteEntryCreateRequestSchema", () => {
  it("accepts an entry at the 100 000 char cap", () => {
    expect(NoteEntryCreateRequestSchema.safeParse({ content: "a".repeat(100_000) }).success).toBe(
      true,
    );
  });

  it("rejects one char past the cap", () => {
    expect(NoteEntryCreateRequestSchema.safeParse({ content: "a".repeat(100_001) }).success).toBe(
      false,
    );
  });

  it("rejects an empty or whitespace-only entry — an entry has to say something", () => {
    expect(NoteEntryCreateRequestSchema.safeParse({ content: "" }).success).toBe(false);
    expect(NoteEntryCreateRequestSchema.safeParse({ content: "   \n " }).success).toBe(false);
  });
});

describe("NoteEntryUpdateRequestSchema", () => {
  it("rejects an update with no entry id", () => {
    expect(NoteEntryUpdateRequestSchema.safeParse({ content: "revised" }).success).toBe(false);
  });
});

describe("ExtractionReportSchema", () => {
  it("accepts a well-formed report", () => {
    expect(ExtractionReportSchema.safeParse(report).success).toBe(true);
  });

  it("rejects a ratio outside 0..1", () => {
    expect(ExtractionReportSchema.safeParse({ ...report, hasTextRatio: 1.5 }).success).toBe(false);
  });

  it("rejects a non-integer page count", () => {
    expect(ExtractionReportSchema.safeParse({ ...report, pageCount: 2.5 }).success).toBe(false);
  });

  it("rejects a recommendation outside the enum", () => {
    const parsed = ExtractionReportSchema.safeParse({ ...report, recommendation: "consider_llm" });
    expect(parsed.success).toBe(false);
  });
});

describe("ConceptRefreshResponseSchema", () => {
  it("rejects a negative llmCalls — the reported cost has to stay honest", () => {
    expect(
      ConceptRefreshResponseSchema.safeParse({
        scannedPdfs: 1,
        skippedPdfs: 0,
        llmCalls: -1,
        conceptsCreated: 0,
        conceptsUpdated: 0,
      }).success,
    ).toBe(false);
  });
});

describe("PdfSummarySchema", () => {
  it("rejects a zero page count", () => {
    expect(
      PdfSummarySchema.safeParse({
        id: "deck",
        filename: "deck.pdf",
        pageCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
