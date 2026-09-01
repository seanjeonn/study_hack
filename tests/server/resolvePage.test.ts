import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfSummary } from "@/lib/schemas";
import { getPdfSummary } from "@/lib/server/pdfStore";
import { resolvePage } from "@/lib/server/resolvePage";

// pdfStore pulls in pdf-to-img's native rendering path, which this has nothing
// to say about — the routing decision is the whole subject here.
vi.mock("@/lib/server/pdfStore", () => ({ getPdfSummary: vi.fn() }));

const summary: PdfSummary = {
  id: "deck",
  filename: "deck.pdf",
  pageCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(getPdfSummary).mockResolvedValue(summary);
});

describe("resolvePage", () => {
  it("rejects a malformed id before touching the filesystem", async () => {
    expect(await resolvePage("../etc", "1")).toEqual({ status: 400, error: "invalid pdf id" });
    expect(getPdfSummary).not.toHaveBeenCalled();
  });

  it("404s a pdf that is not in the workspace", async () => {
    vi.mocked(getPdfSummary).mockResolvedValue(undefined);
    expect(await resolvePage("deck", "1")).toEqual({ status: 404, error: "pdf not found" });
  });

  it.each(["abc", "", "0", "-1", "1.5", "4"])("400s the page %o", async (rawPage) => {
    expect(await resolvePage("deck", rawPage)).toEqual({ status: 400, error: "page out of range" });
  });

  it("resolves a page in range", async () => {
    expect(await resolvePage("deck", "1")).toEqual({ pageNumber: 1 });
    expect(await resolvePage("deck", "3")).toEqual({ pageNumber: 3 });
  });
});
