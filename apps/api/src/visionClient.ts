import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Result of transcribing a single page image. Validated at the boundary before
 * it is used — LLM output is external input (zod SSOT in AGENTS.md).
 */
const VisionResultSchema = z.object({ visionText: z.string() });
export type VisionResult = z.infer<typeof VisionResultSchema>;

const TRANSCRIPTION_PROMPT = `Transcribe this lecture-slide page to Markdown, faithfully and completely, in natural reading order.
- Render mathematical expressions as LaTeX (inline $...$ or block $$...$$).
- Render code as fenced code blocks.
- Describe diagrams, figures, and charts concisely inside square brackets, e.g. [Diagram: client–server topology].
- Render tables as Markdown tables.
Transcribe everything visible, including text rendered inside images. Output only the transcription, with no preamble or commentary.`;

// Constructed lazily so text-only runs (VISION_ENABLED=false / no API key) never
// require ANTHROPIC_API_KEY — the SDK throws at construction when it is missing.
let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** Send a rendered page PNG to the vision model and return its Markdown transcription. */
export async function transcribePagePng(png: Buffer): Promise<VisionResult> {
  const resp = await getClient().messages.create({
    model: process.env.VISION_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 4096,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
          },
          { type: "text", text: TRANSCRIPTION_PROMPT },
        ],
      },
    ],
  });

  // A safety refusal degrades to "no vision text" for this page so the caller
  // falls back to the text layer, rather than failing the whole document.
  if (resp.stop_reason === "refusal") {
    return VisionResultSchema.parse({ visionText: "" });
  }

  let visionText = "";
  for (const block of resp.content) {
    if (block.type === "text") visionText += block.text;
  }
  return VisionResultSchema.parse({ visionText: visionText.trim() });
}
