import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ROOT,
  cacheDir,
  conceptPath,
  conceptSlug,
  conceptsDir,
  isValidId,
  isValidPageNumber,
  metaPath,
  pageAiNotePath,
  pageNotePath,
  pageStem,
  pageTextPath,
  pdfDir,
  slugify,
  sourcePath,
} from "@/lib/server/workspace";

describe("isValidId", () => {
  it.each(["a", "0", "deck", "my-notes-v2", "a-b-c", "a".repeat(100)])("accepts %s", (id) => {
    expect(isValidId(id)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["leading dash", "-a"],
    ["uppercase", "Deck"],
    ["underscore", "my_deck"],
    ["dot", "deck.pdf"],
    ["slash", "a/b"],
    ["traversal", ".."],
    ["parent segment", "../etc"],
    ["space", "my deck"],
    ["non-latin", "그래프"],
    ["101 chars", "a".repeat(101)],
  ])("rejects %s", (_label, id) => {
    expect(isValidId(id)).toBe(false);
  });
});

describe("slugify", () => {
  it("lowercases and dashes a normal filename", () => {
    expect(slugify("My Notes v2.pdf")).toBe("my-notes-v2");
  });

  it("strips the extension case-insensitively", () => {
    expect(slugify("Report.PDF")).toBe("report");
  });

  it("falls back to `pdf` when nothing survives", () => {
    expect(slugify("---.pdf")).toBe("pdf");
    expect(slugify("그래프 이론.pdf")).toBe("pdf");
  });

  it("truncates to 100 chars without leaving a trailing dash", () => {
    const slug = slugify(`${"a".repeat(99)} ${"b".repeat(10)}.pdf`);
    expect(slug).toBe("a".repeat(99));
    expect(slug.length).toBeLessThanOrEqual(100);
  });

  it("ignores directory components", () => {
    expect(slugify("/etc/passwd/Deck One.pdf")).toBe("deck-one");
  });
});

describe("conceptSlug", () => {
  it("hashes a name that slugifies away to nothing", () => {
    const slug = conceptSlug("그래프");
    expect(slug).toMatch(/^c-[0-9a-f]{10}$/);
    // Stable across calls, and distinct per name — otherwise every non-Latin
    // concept would collapse into one file.
    expect(conceptSlug("그래프")).toBe(slug);
    expect(conceptSlug("탐색")).not.toBe(slug);
  });

  it("suffixes slugs that would collide with a concepts/ route", () => {
    expect(conceptSlug("graph")).toBe("graph-concept");
    expect(conceptSlug("Refresh")).toBe("refresh-concept");
  });

  it("leaves a genuine `PDF` concept alone rather than hashing it", () => {
    expect(conceptSlug("PDF")).toBe("pdf");
  });

  it("passes an ordinary name through", () => {
    expect(conceptSlug("Breadth First Search")).toBe("breadth-first-search");
  });
});

describe("pageStem", () => {
  it("zero-pads to three digits and grows past them", () => {
    expect(pageStem(1)).toBe("page-001");
    expect(pageStem(42)).toBe("page-042");
    expect(pageStem(100)).toBe("page-100");
    expect(pageStem(1234)).toBe("page-1234");
  });
});

describe("isValidPageNumber", () => {
  it.each([
    [1, 10, true],
    [10, 10, true],
    [0, 10, false],
    [11, 10, false],
    [-1, 10, false],
    [1.5, 10, false],
    [Number.NaN, 10, false],
    [Number.POSITIVE_INFINITY, 10, false],
    [1, 0, false],
  ])("(%s of %s) -> %s", (pageNumber, pageCount, expected) => {
    expect(isValidPageNumber(pageNumber, pageCount)).toBe(expected);
  });
});

describe("path builders", () => {
  it("rejects an id that would escape the workspace", () => {
    expect(() => pdfDir("../etc")).toThrow(/invalid pdf id/);
    expect(() => sourcePath("..")).toThrow(/invalid pdf id/);
    expect(() => conceptPath("../etc")).toThrow(/invalid concept slug/);
  });

  it("builds every path under the workspace root", () => {
    const paths = [
      pdfDir("deck"),
      sourcePath("deck"),
      cacheDir("deck"),
      metaPath("deck"),
      pageTextPath("deck", 7),
      pageNotePath("deck", 7),
      pageAiNotePath("deck", 7),
      conceptsDir(),
      conceptPath("graph-concept"),
    ];
    for (const p of paths) {
      expect(p.startsWith(WORKSPACE_ROOT + path.sep)).toBe(true);
    }
  });

  it("puts each file where the layout says it goes", () => {
    const rel = (p: string) => path.relative(WORKSPACE_ROOT, p).split(path.sep).join("/");
    expect(rel(pdfDir("deck"))).toBe("deck");
    expect(rel(sourcePath("deck"))).toBe("deck/source.pdf");
    expect(rel(cacheDir("deck"))).toBe("deck/.cache");
    expect(rel(metaPath("deck"))).toBe("deck/.cache/meta.json");
    expect(rel(pageTextPath("deck", 7))).toBe("deck/.cache/text/page-007.txt");
    expect(rel(pageNotePath("deck", 7))).toBe("deck/notes/page-007.md");
    expect(rel(pageAiNotePath("deck", 7))).toBe("deck/ai/page-007.md");
    expect(rel(conceptsDir())).toBe("concepts");
    expect(rel(conceptPath("graph-concept"))).toBe("concepts/graph-concept.md");
  });
});
