import { describe, expect, it } from "vitest";
import { classifyKey } from "@/lib/apiKey";
import {
  ApiKeySchema,
  AppConfigSchema,
  ConceptRefreshResponseSchema,
  ExtractionReportSchema,
  NoteEntryCreateRequestSchema,
  NoteEntryUpdateRequestSchema,
  PdfSummarySchema,
  SettingsResponseSchema,
  SettingsUpdateRequestSchema,
  SubjectUpdateRequestSchema,
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

describe("SubjectUpdateRequestSchema", () => {
  it("trims the subject", () => {
    const parsed = SubjectUpdateRequestSchema.safeParse({ subject: "  기계학습  " });
    expect(parsed.success && parsed.data.subject).toBe("기계학습");
  });

  it("accepts an empty subject — that is how a PDF is ungrouped", () => {
    expect(SubjectUpdateRequestSchema.safeParse({ subject: "" }).success).toBe(true);
  });

  it("accepts a subject at the 100 char cap and rejects one past it", () => {
    expect(SubjectUpdateRequestSchema.safeParse({ subject: "a".repeat(100) }).success).toBe(true);
    expect(SubjectUpdateRequestSchema.safeParse({ subject: "a".repeat(101) }).success).toBe(false);
  });

  it("rejects a subject with a newline in it", () => {
    expect(SubjectUpdateRequestSchema.safeParse({ subject: "기계\n학습" }).success).toBe(false);
  });
});

describe("PdfSummarySchema", () => {
  const summary = {
    id: "deck",
    filename: "deck.pdf",
    pageCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("rejects a zero page count", () => {
    expect(PdfSummarySchema.safeParse({ ...summary, pageCount: 0 }).success).toBe(false);
  });

  it("parses a summary with or without a subject", () => {
    expect(PdfSummarySchema.safeParse(summary).success).toBe(true);
    const parsed = PdfSummarySchema.safeParse({ ...summary, subject: "기계학습" });
    expect(parsed.success && parsed.data.subject).toBe("기계학습");
  });
});

describe("ApiKeySchema", () => {
  it("trims a pasted key", () => {
    const parsed = ApiKeySchema.safeParse("  sk-abc\n");
    expect(parsed.success && parsed.data).toBe("sk-abc");
  });

  it("accepts the empty string, which is how a key is removed", () => {
    expect(ApiKeySchema.safeParse("").success).toBe(true);
  });

  it("rejects whitespace inside the key", () => {
    // Always a mis-paste, and it would be stored and sent verbatim.
    expect(ApiKeySchema.safeParse("sk-ab cd").success).toBe(false);
  });
});

describe("AppConfigSchema", () => {
  it("defaults both booleans off", () => {
    const parsed = AppConfigSchema.safeParse({});
    expect(parsed.success && parsed.data).toEqual({
      telemetryOptIn: false,
      installEventSent: false,
    });
  });

  it("rejects a non-boolean opt-in rather than coercing it", () => {
    // A truthy string here would silently turn telemetry on.
    expect(AppConfigSchema.safeParse({ telemetryOptIn: "true" }).success).toBe(false);
  });
});

describe("SettingsResponseSchema", () => {
  it("parses the masked view", () => {
    expect(
      SettingsResponseSchema.safeParse({ hasKey: true, keyKind: "beta", telemetryOptIn: false })
        .success,
    ).toBe(true);
    expect(
      SettingsResponseSchema.safeParse({ hasKey: false, keyKind: null, telemetryOptIn: false })
        .success,
    ).toBe(true);
  });

  it("has no field that could carry the key itself", () => {
    const parsed = SettingsResponseSchema.parse({
      hasKey: true,
      keyKind: "openai",
      telemetryOptIn: true,
      apiKey: "sk-secret",
    });
    expect(Object.keys(parsed).sort()).toEqual(["hasKey", "keyKind", "telemetryOptIn"]);
  });
});

describe("SettingsUpdateRequestSchema", () => {
  it("accepts a partial update", () => {
    expect(SettingsUpdateRequestSchema.safeParse({}).success).toBe(true);
    expect(SettingsUpdateRequestSchema.safeParse({ telemetryOptIn: true }).success).toBe(true);
    expect(SettingsUpdateRequestSchema.safeParse({ apiKey: "sk-abc" }).success).toBe(true);
  });

  it("rejects a malformed key", () => {
    expect(SettingsUpdateRequestSchema.safeParse({ apiKey: "sk ab" }).success).toBe(false);
    expect(SettingsUpdateRequestSchema.safeParse({ apiKey: 7 }).success).toBe(false);
  });
});

describe("classifyKey", () => {
  it("tells a beta token from an OpenAI key", () => {
    expect(classifyKey("sb-beta-0123456789abcdef01234567")).toBe("beta");
    expect(classifyKey("sk-proj-abc")).toBe("openai");
  });

  it("calls anything else 'other' rather than rejecting it", () => {
    // Ollama, LM Studio, and company gateways issue keys in any shape.
    expect(classifyKey("ollama")).toBe("other");
    expect(classifyKey("")).toBe("other");
  });
});
