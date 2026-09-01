import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Concept } from "@/lib/server/concepts";
import { freshWorkspace } from "@/tests/helpers/workspace";

let root: string;

beforeEach(() => {
  root = freshWorkspace();
});

/** Import after freshWorkspace() — WORKSPACE_ROOT is resolved at module load. */
const load = () => import("@/lib/server/concepts");

const concept = (over: Partial<Concept> = {}): Concept => ({
  slug: "graph-concept",
  name: "Graph",
  aliases: [],
  sources: [],
  related: [],
  updated: "2026-01-01T00:00:00.000Z",
  body: "A graph is a set of nodes and edges.\n",
  ...over,
});

async function writeRaw(slug: string, contents: string): Promise<void> {
  await fs.mkdir(path.join(root, "concepts"), { recursive: true });
  await fs.writeFile(path.join(root, "concepts", `${slug}.md`), contents);
}

describe("readConcept / writeConcept", () => {
  it("round-trips a concept, body included", async () => {
    const { readConcept, writeConcept } = await load();
    const original = concept({
      aliases: ["G"],
      sources: [{ pdf: "deck", pages: [1, 4] }],
      related: ["tree"],
      body: "  indented\n\n\tmixed\n",
    });
    await writeConcept(original);
    // Every field survives, and the body's own whitespace is untouched — apart
    // from the blank line serializeFrontmatter puts after the closing fence,
    // which comes back as one leading newline. Writing it again strips it, so
    // the file on disk is stable across refreshes.
    expect(await readConcept("graph-concept")).toEqual({
      ...original,
      body: `\n${original.body}`,
    });
  });

  it("returns undefined for a concept that does not exist", async () => {
    const { readConcept } = await load();
    expect(await readConcept("nope")).toBeUndefined();
  });

  it("fills in defaults for a hand-written file with only a name", async () => {
    const { readConcept } = await load();
    await writeRaw("graph-concept", "---\nname: Graph\n---\nBy hand.\n");
    expect(await readConcept("graph-concept")).toEqual({
      slug: "graph-concept",
      name: "Graph",
      aliases: [],
      sources: [],
      related: [],
      updated: "",
      body: "By hand.\n",
    });
  });

  it("skips a file whose frontmatter has the wrong shape", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readConcept } = await load();
    await writeRaw("graph-concept", "---\nname: 123\n---\n\nbody\n");
    expect(await readConcept("graph-concept")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("skips a file whose frontmatter does not parse", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readConcept } = await load();
    await writeRaw("graph-concept", "---\naliases: [a, b\n---\n\nbody\n");
    expect(await readConcept("graph-concept")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("listConcepts", () => {
  it("returns nothing when no concepts directory exists", async () => {
    const { listConcepts } = await load();
    expect(await listConcepts()).toEqual([]);
  });

  it("drops one broken file and still returns the good ones", async () => {
    // The "a broken file must never crash a request" contract.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { listConcepts, writeConcept } = await load();
    await writeConcept(concept({ slug: "graph-concept", name: "Graph" }));
    await writeConcept(concept({ slug: "tree", name: "Tree" }));
    await writeRaw("broken", "---\nname: 123\n---\n\nbody\n");
    const names = (await listConcepts()).map((c) => c.name).sort();
    expect(names).toEqual(["Graph", "Tree"]);
    expect(warn).toHaveBeenCalled();
  });

  it("ignores non-markdown files and names that are not valid slugs", async () => {
    const { listConcepts, writeConcept } = await load();
    await writeConcept(concept({ slug: "tree", name: "Tree" }));
    await fs.writeFile(path.join(root, "concepts", "notes.txt"), "ignored");
    await fs.writeFile(path.join(root, "concepts", "Bad_Name.md"), "---\nname: X\n---\n\nx\n");
    expect((await listConcepts()).map((c) => c.slug)).toEqual(["tree"]);
  });
});

describe("buildGraph", () => {
  const node = (slug: string, name: string, related: string[] = [], pdfs: string[] = []) =>
    concept({
      slug,
      name,
      related,
      sources: pdfs.map((pdf) => ({ pdf, pages: [1] })),
    });

  it("normalizes a reciprocal pair into a single undirected edge", async () => {
    const { buildGraph } = await load();
    const graph = buildGraph([node("tree", "Tree", ["graph"]), node("graph", "Graph", ["tree"])]);
    expect(graph.edges).toEqual([{ source: "graph", target: "tree" }]);
  });

  it("drops self-edges and edges pointing at a concept that no longer exists", async () => {
    const { buildGraph } = await load();
    const graph = buildGraph([
      node("graph", "Graph", ["graph", "deleted", "tree"]),
      node("tree", "Tree"),
    ]);
    expect(graph.edges).toEqual([{ source: "graph", target: "tree" }]);
  });

  it("counts distinct pdfs, not sources", async () => {
    const { buildGraph } = await load();
    const graph = buildGraph([
      concept({
        slug: "graph",
        name: "Graph",
        sources: [
          { pdf: "deck", pages: [1] },
          { pdf: "deck", pages: [2] },
          { pdf: "other", pages: [3] },
        ],
      }),
    ]);
    expect(graph.nodes[0].pdfCount).toBe(2);
  });

  it("sorts nodes by pdfCount desc, then by name", async () => {
    const { buildGraph } = await load();
    // Insertion order matches neither the pdfCount order nor the name order.
    const graph = buildGraph([
      node("beta", "Beta", [], ["deck"]),
      node("alpha", "Alpha", [], ["deck"]),
      node("wide", "Wide", [], ["deck", "other"]),
    ]);
    expect(graph.nodes.map((n) => n.slug)).toEqual(["wide", "alpha", "beta"]);
  });
});
