import "server-only";

import OpenAI from "openai";

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

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
  client = new OpenAI({ apiKey });
  return client;
}
