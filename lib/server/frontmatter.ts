import "server-only";

import { parse, stringify } from "yaml";

/**
 * Split a markdown file into its YAML frontmatter and its body. The body is
 * sliced verbatim — concept bodies belong to the user, so a round-trip through
 * here must never reflow or re-encode them.
 *
 * `data` is `undefined` when the frontmatter exists but does not parse, which
 * lets a caller skip a hand-broken file instead of guessing at its contents.
 */
export function parseFrontmatter(raw: string): { data: unknown; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  try {
    return { data: parse(raw.slice(3, end)) ?? {}, body };
  } catch {
    return { data: undefined, body };
  }
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  return `---\n${stringify(data)}---\n\n${body.replace(/^\n+/, "")}`;
}
