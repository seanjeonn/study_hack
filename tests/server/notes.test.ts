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

const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe("note entries", () => {
  it("reads no entries for a page with no note file", async () => {
    const { readNoteEntries } = await load();
    expect(await readNoteEntries("deck", 1)).toEqual([]);
  });

  it("parses an empty file as no entries", async () => {
    const { parseNoteEntries } = await load();
    expect(parseNoteEntries("")).toEqual([]);
    expect(parseNoteEntries("\n\n  \n")).toEqual([]);
  });

  it("reads a flat legacy note as one preamble entry", async () => {
    const { parseNoteEntries } = await load();
    expect(parseNoteEntries("just a note\nsecond line\n")).toEqual([
      { id: "", content: "just a note\nsecond line" },
    ]);
  });

  it("keeps the reader's own ## heading inside the entry", async () => {
    const { parseNoteEntries } = await load();
    const raw = "intro\n\n## Graph theory\n\nBFS then DFS\n";
    expect(parseNoteEntries(raw)).toEqual([
      { id: "", content: "intro\n\n## Graph theory\n\nBFS then DFS" },
    ]);
  });

  it("splits a note on complete timestamp headings only", async () => {
    const { parseNoteEntries } = await load();
    const raw = "## 2026-09-01 14:03:22\n\nfirst\n\n## 2026-09-01 15:10:04\n\nsecond\n";
    expect(parseNoteEntries(raw)).toEqual([
      { id: "2026-09-01 14:03:22", content: "first" },
      { id: "2026-09-01 15:10:04", content: "second" },
    ]);
  });

  it("appends the first entry as a timestamped section", async () => {
    const { appendNoteEntry, readPageNote } = await load();
    const entries = await appendNoteEntry("deck", 3, "  first thought  ");
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toMatch(STAMP);
    expect(entries[0].content).toBe("first thought");
    expect(await readPageNote("deck", 3)).toBe(`## ${entries[0].id}\n\nfirst thought\n`);
  });

  it("appends without touching a single byte of what is already there", async () => {
    const { appendNoteEntry, readPageNote, writePageNote } = await load();
    const existing = "hand written\n\n## Graph theory\n\n  indented\n";
    await writePageNote("deck", 4, existing);
    await appendNoteEntry("deck", 4, "added later");
    const raw = await readPageNote("deck", 4);
    expect(raw.startsWith(existing.trimEnd())).toBe(true);
    expect(raw).toContain("added later");
  });

  it("gives every entry in a file a unique stamp", async () => {
    const { entryStamp } = await load();
    const now = new Date(2026, 8, 1, 14, 3, 22);
    const taken = new Set<string>();
    const stamps = [entryStamp(now, taken), "", ""];
    taken.add(stamps[0]);
    stamps[1] = entryStamp(now, taken);
    taken.add(stamps[1]);
    stamps[2] = entryStamp(now, taken);
    expect(stamps).toEqual(["2026-09-01 14:03:22", "2026-09-01 14:03:23", "2026-09-01 14:03:24"]);
    expect(new Set(stamps).size).toBe(3);
  });

  it("formats a stamp in local time", async () => {
    const { entryStamp } = await load();
    const now = new Date(2026, 8, 1, 9, 5, 7);
    const stamp = entryStamp(now, new Set());
    expect(stamp).toMatch(STAMP);
    expect(stamp).toBe("2026-09-01 09:05:07");
  });

  it("edits one entry and leaves the others byte-identical", async () => {
    const { appendNoteEntry, parseNoteEntries, readPageNote, updateNoteEntry, writePageNote } =
      await load();
    await writePageNote(
      "deck",
      5,
      "## 2026-09-01 10:00:00\n\nfirst\n\n## 2026-09-01 11:00:00\n\nsecond\n\n## 2026-09-01 12:00:00\n\nthird\n",
    );
    const updated = await updateNoteEntry("deck", 5, "2026-09-01 11:00:00", "second, revised");
    expect(updated).toBeDefined();
    expect(parseNoteEntries(await readPageNote("deck", 5))).toEqual([
      { id: "2026-09-01 10:00:00", content: "first" },
      { id: "2026-09-01 11:00:00", content: "second, revised" },
      { id: "2026-09-01 12:00:00", content: "third" },
    ]);
    // appendNoteEntry stays usable after a re-serialization.
    expect(await appendNoteEntry("deck", 5, "fourth")).toHaveLength(4);
  });

  it("edits a legacy preamble entry", async () => {
    const { readNoteEntries, updateNoteEntry, writePageNote } = await load();
    await writePageNote("deck", 6, "old flat note\n");
    expect(await updateNoteEntry("deck", 6, "", "rewritten")).toEqual([
      { id: "", content: "rewritten" },
    ]);
    expect(await readNoteEntries("deck", 6)).toEqual([{ id: "", content: "rewritten" }]);
  });

  it("returns undefined for an entry id that is no longer in the file", async () => {
    const { updateNoteEntry, writePageNote } = await load();
    await writePageNote("deck", 7, "## 2026-09-01 10:00:00\n\nfirst\n");
    expect(await updateNoteEntry("deck", 7, "2020-01-01 00:00:00", "nope")).toBeUndefined();
  });

  it("round-trips through render and parse", async () => {
    const { parseNoteEntries, renderNoteEntries } = await load();
    const raw = "preamble\n\n## 2026-09-01 10:00:00\n\nfirst\n\n## 2026-09-01 11:00:00\n\nsecond\n";
    const once = renderNoteEntries(parseNoteEntries(raw));
    expect(renderNoteEntries(parseNoteEntries(once))).toBe(once);
    expect(parseNoteEntries(once)).toEqual(parseNoteEntries(raw));
  });
});
