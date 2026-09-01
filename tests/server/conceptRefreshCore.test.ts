import { beforeEach, describe, expect, it } from "vitest";
import type { ExtractedConcept } from "@/lib/server/conceptRefreshCore";
import { freshWorkspace } from "@/tests/helpers/workspace";

beforeEach(() => {
  freshWorkspace();
});

/** Import after freshWorkspace() — WORKSPACE_ROOT is resolved at module load. */
const load = () => import("@/lib/server/conceptRefreshCore");

const extracted = (over: Partial<ExtractedConcept> = {}): ExtractedConcept => ({
  name: "Breadth First Search",
  aliases: ["BFS"],
  description: "Visit one layer at a time.",
  pages: [1, 2],
  related: [],
  ...over,
});

describe("fingerprintPages", () => {
  it("is stable for the same input", async () => {
    const { fingerprintPages } = await load();
    const pages = [
      { pageNumber: 1, text: "alpha" },
      { pageNumber: 2, text: "beta" },
    ];
    expect(fingerprintPages(2, pages)).toBe(fingerprintPages(2, [...pages]));
  });

  it("changes when a page's text changes", async () => {
    const { fingerprintPages } = await load();
    const before = fingerprintPages(1, [{ pageNumber: 1, text: "alpha" }]);
    expect(fingerprintPages(1, [{ pageNumber: 1, text: "alphb" }])).not.toBe(before);
  });

  it("changes when a page number changes", async () => {
    const { fingerprintPages } = await load();
    const before = fingerprintPages(2, [{ pageNumber: 1, text: "alpha" }]);
    expect(fingerprintPages(2, [{ pageNumber: 2, text: "alpha" }])).not.toBe(before);
  });

  it("changes when the page count changes", async () => {
    const { fingerprintPages } = await load();
    const pages = [{ pageNumber: 1, text: "alpha" }];
    expect(fingerprintPages(2, pages)).not.toBe(fingerprintPages(1, pages));
  });

  it("changes when the pages are reordered", async () => {
    const { fingerprintPages } = await load();
    const a = { pageNumber: 1, text: "alpha" };
    const b = { pageNumber: 2, text: "beta" };
    expect(fingerprintPages(2, [a, b])).not.toBe(fingerprintPages(2, [b, a]));
  });

  it("separates the fields, so a shifted split is a different document", async () => {
    // The NUL separators are what keep these two apart.
    const { fingerprintPages } = await load();
    const a = fingerprintPages(1, [{ pageNumber: 1, text: "12" }]);
    const b = fingerprintPages(1, [{ pageNumber: 11, text: "2" }]);
    expect(a).not.toBe(b);
  });
});

describe("chunkPages", () => {
  it("returns nothing for no pages", async () => {
    const { chunkPages } = await load();
    expect(chunkPages([])).toEqual([]);
  });

  it("keeps everything in one chunk while under the budget", async () => {
    const { CONCEPT_BATCH_CHARS, chunkPages } = await load();
    const pages = [
      { pageNumber: 1, text: "a".repeat(CONCEPT_BATCH_CHARS / 2) },
      { pageNumber: 2, text: "b".repeat(CONCEPT_BATCH_CHARS / 2) },
    ];
    expect(chunkPages(pages)).toEqual([pages]);
  });

  it("splits once the budget would be exceeded", async () => {
    const { CONCEPT_BATCH_CHARS, chunkPages } = await load();
    const pages = [
      { pageNumber: 1, text: "a".repeat(CONCEPT_BATCH_CHARS / 2) },
      { pageNumber: 2, text: "b".repeat(CONCEPT_BATCH_CHARS / 2) },
      { pageNumber: 3, text: "c" },
    ];
    const chunks = chunkPages(pages);
    expect(chunks.map((c) => c.map((p) => p.pageNumber))).toEqual([[1, 2], [3]]);
  });

  it("gives an oversized page a chunk of its own", async () => {
    const { CONCEPT_BATCH_CHARS, chunkPages } = await load();
    const chunks = chunkPages([
      { pageNumber: 1, text: "a" },
      { pageNumber: 2, text: "b".repeat(CONCEPT_BATCH_CHARS * 2) },
      { pageNumber: 3, text: "c" },
    ]);
    expect(chunks.map((c) => c.map((p) => p.pageNumber))).toEqual([[1], [2], [3]]);
  });

  it("emits the trailing partial chunk", async () => {
    const { CONCEPT_BATCH_CHARS, chunkPages } = await load();
    const pages = Array.from({ length: 5 }, (_, i) => ({
      pageNumber: i + 1,
      text: "a".repeat(CONCEPT_BATCH_CHARS),
    }));
    const chunks = chunkPages(pages);
    expect(chunks).toHaveLength(5);
    expect(chunks.at(-1)).toEqual([pages[4]]);
  });
});

describe("mergeConcept", () => {
  it("creates a concept file from the extraction", async () => {
    const { mergeConcept } = await load();
    const { readConcept } = await import("@/lib/server/concepts");
    expect(
      await mergeConcept(extracted({ related: ["Graph", "BFS dup", "BFS dup"] }), "deck"),
    ).toBe("created");
    const written = await readConcept("breadth-first-search");
    expect(written).toMatchObject({
      slug: "breadth-first-search",
      name: "Breadth First Search",
      aliases: ["BFS"],
      sources: [{ pdf: "deck", pages: [1, 2] }],
      // `related` is stored as slugs, deduped; `graph` is a reserved segment.
      related: ["graph-concept", "bfs-dup"],
    });
    expect(written?.body).toContain("Visit one layer at a time.");
  });

  it("never lists a concept as related to itself", async () => {
    const { mergeConcept } = await load();
    const { readConcept } = await import("@/lib/server/concepts");
    await mergeConcept(extracted({ related: ["Breadth First Search"] }), "deck");
    expect((await readConcept("breadth-first-search"))?.related).toEqual([]);
  });

  it("leaves the body untouched on a second pass", async () => {
    const { mergeConcept } = await load();
    const { readConcept, writeConcept } = await import("@/lib/server/concepts");
    await mergeConcept(extracted(), "deck");
    const first = await readConcept("breadth-first-search");
    // The user rewrote the prose — a refresh may only widen the frontmatter.
    await writeConcept({ ...first!, body: "My own words.\n" });

    expect(await mergeConcept(extracted({ description: "A different summary." }), "deck")).toBe(
      "updated",
    );
    expect((await readConcept("breadth-first-search"))?.body).toContain("My own words.");
  });

  it("widens sources, aliases and related rather than replacing them", async () => {
    const { mergeConcept } = await load();
    const { readConcept } = await import("@/lib/server/concepts");
    await mergeConcept(extracted({ pages: [1, 2], aliases: ["BFS"], related: ["Graph"] }), "deck");
    await mergeConcept(
      extracted({ pages: [2, 5], aliases: ["BFS", "너비 우선"], related: ["Graph", "Tree"] }),
      "deck",
    );
    await mergeConcept(extracted({ pages: [3] }), "other-deck");

    const merged = await readConcept("breadth-first-search");
    expect(merged?.sources).toEqual([
      { pdf: "deck", pages: [1, 2, 5] },
      { pdf: "other-deck", pages: [3] },
    ]);
    expect(merged?.aliases).toEqual(["BFS", "너비 우선"]);
    expect(merged?.related).toEqual(["graph-concept", "tree"]);
  });

  it("stamps `updated` on every merge", async () => {
    const { mergeConcept } = await load();
    const { readConcept } = await import("@/lib/server/concepts");
    await mergeConcept(extracted(), "deck");
    const first = (await readConcept("breadth-first-search"))!.updated;
    await mergeConcept(extracted(), "deck");
    const second = (await readConcept("breadth-first-search"))!.updated;
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
  });
});
