import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ConceptGraphResponse } from "@/lib/schemas";
import { parseFrontmatter, serializeFrontmatter } from "@/lib/server/frontmatter";
import { atomicWrite, conceptPath, conceptsDir, isValidId } from "@/lib/server/workspace";

/**
 * A concept file's frontmatter. Users edit these files by hand, so every field
 * is validated on read and a file that fails is skipped with a warning rather
 * than taking the whole graph down.
 */
export const ConceptFrontmatterSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  sources: z
    .array(
      z.object({
        pdf: z.string(),
        pages: z.array(z.number().int().positive()).default([]),
      }),
    )
    .default([]),
  related: z.array(z.string()).default([]),
  updated: z.string().default(""),
});

export type ConceptFrontmatter = z.infer<typeof ConceptFrontmatterSchema>;

export interface Concept extends ConceptFrontmatter {
  slug: string;
  body: string;
}

/** Read one concept, or undefined when it is missing or unreadable. */
export async function readConcept(slug: string): Promise<Concept | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(conceptPath(slug), "utf8");
  } catch {
    return undefined;
  }
  const { data, body } = parseFrontmatter(raw);
  const parsed = ConceptFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    console.warn(`[concepts] ${slug}.md has invalid frontmatter — skipping`);
    return undefined;
  }
  return { ...parsed.data, slug, body };
}

export async function writeConcept(concept: Concept): Promise<void> {
  const { slug, body, ...frontmatter } = concept;
  await atomicWrite(conceptPath(slug), serializeFrontmatter(frontmatter, body));
}

/** Every readable concept in the workspace. Broken files are warned about and dropped. */
export async function listConcepts(): Promise<Concept[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(conceptsDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const slugs = entries
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.basename(name, ".md"))
    .filter(isValidId);
  const concepts = await Promise.all(slugs.map(readConcept));
  return concepts.filter((c): c is Concept => c !== undefined);
}

/**
 * Build the graph. `related` is a one-sided list on each file, so edges are
 * normalized to an ordered pair and deduped, and any edge pointing at a
 * concept that no longer exists is dropped — deleting a concept file must not
 * break the map.
 */
export function buildGraph(concepts: Concept[]): ConceptGraphResponse {
  const known = new Set(concepts.map((c) => c.slug));
  const seen = new Set<string>();
  const edges: ConceptGraphResponse["edges"] = [];

  for (const concept of concepts) {
    for (const target of concept.related) {
      if (target === concept.slug || !known.has(target)) continue;
      const [source, sink] = [concept.slug, target].sort();
      const key = `${source} ${sink}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target: sink });
    }
  }

  return {
    nodes: concepts
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        pdfCount: new Set(c.sources.map((s) => s.pdf)).size,
      }))
      .sort((a, b) => b.pdfCount - a.pdfCount || a.name.localeCompare(b.name)),
    edges,
  };
}
