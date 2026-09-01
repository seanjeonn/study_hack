import "server-only";

import OpenAI from "openai";

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

// The AI page note always carries the rendered page image, so it runs on a
// cheap vision-capable model, tunable independently of the text model above.
export const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-5-mini";

export class LlmError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Lazily instantiated so the rest of the API (upload/viewer) keeps working
// without an OpenAI key configured; only LLM-backed routes need it.
let client: OpenAI | undefined;
export function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LlmError(503, "OPENAI_API_KEY is not configured");
  }
  // OPENAI_BASE_URL points at any OpenAI-compatible endpoint (a local model,
  // a proxy). Undefined falls through to the SDK default.
  client = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined });
  return client;
}
