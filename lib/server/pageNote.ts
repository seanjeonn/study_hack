import "server-only";

import fs from "node:fs/promises";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { z } from "zod";
import { LlmError, VISION_MODEL, getClient } from "@/lib/server/llm";
import { readPageNote } from "@/lib/server/notes";
import { getPageText, renderPage } from "@/lib/server/pdfStore";
import { atomicWrite, pageAiNotePath } from "@/lib/server/workspace";

/** Shape the model is instructed (via json_schema) to return — validated before use. */
const AiNoteModelOutputSchema = z.object({
  summary: z.string(),
  feedback: z.array(z.string()),
});

const SYSTEM_PROMPT = [
  "You annotate a SINGLE PAGE of a study PDF.",
  "You are given that page's rendered image, its extracted text when it has any,",
  "and the reader's own note for it, which may be empty.",
  "Use the image for diagrams, figures, and anything the text layer misses.",
  "Write `summary` as a compact account of what the page actually teaches,",
  "in the same language as the page.",
  "Write `feedback` as 2-5 bullets responding to the reader's note: fill the gaps it leaves,",
  "correct what it gets wrong, and name what it missed.",
  "If the note is empty, make the bullets what to focus on here instead.",
  "Never invent material that is not on this page, and never refer to other pages.",
].join(" ");

/** The whole accumulated AI note for a page ("" when nothing has been generated). */
export async function readAiNote(id: string, pageNumber: number): Promise<string> {
  try {
    return await fs.readFile(pageAiNotePath(id, pageNumber), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Generate one AI annotation for a page and append it as a timestamped `##`
 * section. Append-only by design: every previous section stays byte-for-byte
 * intact, so the file is a record the reader accumulates rather than a cache
 * the app overwrites. Returns the full file after the append.
 */
export async function generateAiNote(id: string, pageNumber: number): Promise<string> {
  const pageText = await getPageText(id, pageNumber);
  if (!pageText) throw new LlmError(404, "page text not found");
  const userNote = await readPageNote(id, pageNumber);

  // getClient throws LlmError(503) when no key is configured — the route
  // surfaces that as-is, so the rest of the app stays usable without a key.
  const openai = getClient();

  const noteSection = userNote.trim()
    ? `The reader's note for this page:\n${userNote.trim()}`
    : "The reader has not written a note for this page yet.";

  // The rendered page always goes along: slides mix text with diagrams and
  // figures the text layer cannot carry, so the model reads both.
  const content: ChatCompletionContentPart[] = [
    {
      type: "text",
      text: pageText.hasText
        ? `Page ${pageNumber} text:\n${pageText.text}`
        : `Page ${pageNumber} has no extractable text — read the image.`,
    },
    {
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${(await renderPage(id, pageNumber)).toString("base64")}`,
      },
    },
    { type: "text", text: noteSection },
  ];

  const completion = await openai.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "page_annotation",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            feedback: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "feedback"],
          additionalProperties: false,
        },
      },
    },
  });

  const raw = completion.choices[0]?.message.content;
  if (!raw) throw new LlmError(502, "empty response from the model");
  // Validate the model's output at the boundary before it reaches a file.
  const parsed = AiNoteModelOutputSchema.parse(JSON.parse(raw));

  const section = renderSection(parsed.summary, parsed.feedback);
  const existing = await readAiNote(id, pageNumber);
  const next = existing.trim() ? `${existing.trimEnd()}\n\n${section}` : section;
  await atomicWrite(pageAiNotePath(id, pageNumber), next);
  return next;
}

function renderSection(summary: string, feedback: string[]): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const bullets = feedback.map((line) => `- ${line}`).join("\n");
  return `## ${stamp}\n\n${summary}\n\n${bullets}\n`;
}
