import { describe, expect, it } from "vitest";
import { countSuspiciousChars } from "@/lib/server/textExtract";

describe("countSuspiciousChars", () => {
  it("counts nothing in ordinary text", () => {
    expect(countSuspiciousChars("")).toBe(0);
    expect(countSuspiciousChars("Breadth-first search (BFS) visits 1 layer at a time.")).toBe(0);
    expect(countSuspiciousChars("그래프 이론")).toBe(0);
  });

  it("ignores tab, newline and carriage return", () => {
    expect(countSuspiciousChars("\t\n\r")).toBe(0);
    expect(countSuspiciousChars("a\tb\nc\r\nd")).toBe(0);
  });

  it.each([
    ["NUL", "\u0000"],
    ["last C0 control", "\u001f"],
    ["DEL", "\u007f"],
    ["last C1 control", "\u009f"],
    ["Misc Technical", "⌀"],
    ["Control Pictures", "␿"],
    ["replacement char", "�"],
    ["Specials (unassigned)", "\ufff0"],
    ["Specials (U+FFFF)", "\uffff"],
  ])("counts %s", (_label, ch) => {
    expect(countSuspiciousChars(ch)).toBe(1);
  });

  it("counts every marker in a mixed string", () => {
    expect(countSuspiciousChars("a\u0000b�c⌀")).toBe(3);
  });

  it.each([
    ["space", " "],
    ["just past the C1 block", "\u00a0"],
    ["just before Misc Technical", "⋿"],
    ["just past Control Pictures", "⑀"],
    // Real decks use PUA for bullet/icon glyphs — flagging it is a false positive.
    ["Private Use Area", "\ue000"],
  ])("does not count %s", (_label, ch) => {
    expect(countSuspiciousChars(ch)).toBe(0);
  });

  it("iterates by code point, so an astral char is not two suspicious halves", () => {
    expect(countSuspiciousChars("\u{1F600}")).toBe(0);
  });
});
