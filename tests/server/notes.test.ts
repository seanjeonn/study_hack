import { beforeEach, describe, expect, it } from "vitest";
import { freshWorkspace } from "@/tests/helpers/workspace";

beforeEach(() => {
  freshWorkspace();
});

/** Import after freshWorkspace() — WORKSPACE_ROOT is resolved at module load. */
const load = () => import("@/lib/server/notes");

describe("page notes", () => {
  it("reads an empty note for a page that has none", async () => {
    const { readPageNote } = await load();
    expect(await readPageNote("deck", 1)).toBe("");
  });

  it("round-trips a note verbatim", async () => {
    const { readPageNote, writePageNote } = await load();
    const content = "# 그래프\n\n- BFS\n- DFS\n\n  들여쓴 줄\n";
    await writePageNote("deck", 7, content);
    expect(await readPageNote("deck", 7)).toBe(content);
  });

  it("overwrites on the second save", async () => {
    const { readPageNote, writePageNote } = await load();
    await writePageNote("deck", 1, "first");
    await writePageNote("deck", 1, "second");
    expect(await readPageNote("deck", 1)).toBe("second");
  });

  it("keeps each page's note separate", async () => {
    const { readPageNote, writePageNote } = await load();
    await writePageNote("deck", 1, "one");
    await writePageNote("deck", 2, "two");
    expect(await readPageNote("deck", 1)).toBe("one");
    expect(await readPageNote("deck", 2)).toBe("two");
  });

  it("refuses an id that would escape the workspace", async () => {
    const { readPageNote } = await load();
    await expect(readPageNote("../etc", 1)).rejects.toThrow(/invalid pdf id/);
  });
});
