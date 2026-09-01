import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/server/frontmatter";

describe("parseFrontmatter", () => {
  it("treats a file with no frontmatter as all body", () => {
    const raw = "# Title\n\nsome prose\n";
    expect(parseFrontmatter(raw)).toEqual({ data: {}, body: raw });
  });

  it("treats unterminated frontmatter as all body, verbatim", () => {
    const raw = "---\nname: Graph\nstill going\n";
    expect(parseFrontmatter(raw)).toEqual({ data: {}, body: raw });
  });

  it("parses the frontmatter and slices the body verbatim", () => {
    const body = "  indented\n\n\ttabbed\n\ntrailing spaces   \n";
    const raw = `---\nname: Graph\naliases:\n  - G\n---\n${body}`;
    const parsed = parseFrontmatter(raw);
    expect(parsed.data).toEqual({ name: "Graph", aliases: ["G"] });
    // Exactly one newline after the closing fence is consumed; everything else
    // — indentation, blank lines, trailing whitespace — survives byte for byte.
    expect(parsed.body).toBe(body);
  });

  it("strips only one leading newline after the closing fence", () => {
    const parsed = parseFrontmatter("---\nname: Graph\n---\n\n\nbody\n");
    expect(parsed.body).toBe("\n\nbody\n");
  });

  it("returns undefined data for frontmatter that does not parse", () => {
    // The signal a caller uses to skip a hand-broken file instead of guessing.
    const parsed = parseFrontmatter("---\naliases: [a, b\n---\nbody\n");
    expect(parsed.data).toBeUndefined();
    expect(parsed.body).toBe("body\n");
  });

  it("reads empty frontmatter as an empty object, not null", () => {
    expect(parseFrontmatter("---\n---\nbody\n")).toEqual({ data: {}, body: "body\n" });
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips the data through parseFrontmatter", () => {
    const data = { name: "그래프", aliases: ["graph"], related: [], updated: "2026-01-01" };
    const body = "The body.\n";
    const parsed = parseFrontmatter(serializeFrontmatter(data, body));
    expect(parsed.data).toEqual(data);
    // The body comes back with the blank line serialize inserts after the
    // fence — data round-trips, bytes do not.
    expect(parsed.body).toBe(`\n${body}`);
  });

  it("does NOT round-trip bytes — the blank line after the fence is added", () => {
    // Deliberate: serialize always emits `---\n\n` before the body and strips
    // the body's own leading newlines. Asserting it so nobody "fixes" the
    // asymmetry and silently rewrites every concept file on the next write.
    const raw = "---\nname: Graph\n---\nbody\n";
    const { data, body } = parseFrontmatter(raw);
    const round = serializeFrontmatter(data as Record<string, unknown>, body);
    expect(round).not.toBe(raw);
    expect(round).toBe("---\nname: Graph\n---\n\nbody\n");
  });
});
