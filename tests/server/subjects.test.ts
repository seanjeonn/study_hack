import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshWorkspace } from "@/tests/helpers/workspace";

let root: string;

beforeEach(() => {
  root = freshWorkspace();
});

/** Import after freshWorkspace() — WORKSPACE_ROOT is resolved at module load. */
const load = () => import("@/lib/server/subjects");

async function writeRaw(id: string, contents: string): Promise<void> {
  await fs.mkdir(path.join(root, id), { recursive: true });
  await fs.writeFile(path.join(root, id, "subject.md"), contents);
}

const readRaw = (id: string) => fs.readFile(path.join(root, id, "subject.md"), "utf8");

describe("readSubject / writeSubject", () => {
  it("returns undefined when the PDF has no subject file", async () => {
    const { readSubject } = await load();
    await fs.mkdir(path.join(root, "deck"), { recursive: true });
    expect(await readSubject("deck")).toBeUndefined();
  });

  it("round-trips a Korean subject", async () => {
    const { readSubject, writeSubject } = await load();
    await writeSubject("deck", "기계학습");
    expect(await readSubject("deck")).toBe("기계학습");
  });

  it("keeps the body the user wrote when the subject changes", async () => {
    // subject.md is the user's file — only the one field is ours to rewrite.
    const { readSubject, writeSubject } = await load();
    await writeRaw("deck", "---\nsubject: 기계학습\n---\n\nMy own notes about this deck.\n");
    await writeSubject("deck", "자료구조");
    expect(await readSubject("deck")).toBe("자료구조");
    expect(await readRaw("deck")).toContain("My own notes about this deck.");
  });

  it("treats frontmatter that does not parse as ungrouped, without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readSubject } = await load();
    await writeRaw("deck", "---\nsubject: [a, b\n---\n\nbody\n");
    expect(await readSubject("deck")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("treats a wrong-shaped subject as ungrouped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readSubject } = await load();
    await writeRaw("deck", "---\nsubject: [1, 2]\n---\n\nbody\n");
    expect(await readSubject("deck")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("treats a whitespace-only subject as ungrouped", async () => {
    const { readSubject } = await load();
    await writeRaw("deck", '---\nsubject: "   "\n---\n\nbody\n');
    expect(await readSubject("deck")).toBeUndefined();
  });

  it("ungroups when an empty subject is written", async () => {
    const { readSubject, writeSubject } = await load();
    await writeSubject("deck", "기계학습");
    await writeSubject("deck", "");
    expect(await readSubject("deck")).toBeUndefined();
  });

  it("rejects an id that would escape the workspace", async () => {
    const { readSubject } = await load();
    await expect(readSubject("../etc")).rejects.toThrow(/invalid pdf id/);
  });
});

describe("listSubjects / listPdfIdsWithSubject", () => {
  it("dedupes and sorts the subjects in use", async () => {
    const { listSubjects, writeSubject } = await load();
    await writeSubject("deck", "자료구조");
    await writeSubject("other", "기계학습");
    await writeSubject("third", "기계학습");
    expect(await listSubjects()).toEqual(["기계학습", "자료구조"]);
  });

  it("ignores ungrouped PDFs", async () => {
    const { listSubjects, writeSubject } = await load();
    await writeSubject("deck", "기계학습");
    await fs.mkdir(path.join(root, "plain"), { recursive: true });
    expect(await listSubjects()).toEqual(["기계학습"]);
  });

  it("matches a subject exactly", async () => {
    const { listPdfIdsWithSubject, writeSubject } = await load();
    await writeSubject("deck", "기계학습");
    await writeSubject("other", "기계학습 2");
    expect(await listPdfIdsWithSubject("기계학습")).toEqual(["deck"]);
    expect(await listPdfIdsWithSubject("기계")).toEqual([]);
  });
});
