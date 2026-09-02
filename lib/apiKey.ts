/**
 * What kind of key the user pasted.
 *
 * The prefix is the whole mechanism: a free-beta token is issued by us and
 * routed to the managed proxy, an `sk-…` key goes straight to OpenAI, and the
 * two have to be told apart without asking the user which one they have.
 *
 * Safe to import from client components: no node-only code. The server uses it
 * to pick a base URL, the settings UI to label the saved key.
 */
export const BETA_TOKEN_PREFIX = "sb-beta-";

export type KeyKind = "openai" | "beta" | "other";

/**
 * `other` is not an error — an OpenAI-compatible endpoint (Ollama, LM Studio,
 * a company gateway) issues keys in any shape it likes, and those keep working.
 * It only means "we cannot route this for you".
 */
export function classifyKey(apiKey: string): KeyKind {
  if (apiKey.startsWith(BETA_TOKEN_PREFIX)) return "beta";
  if (apiKey.startsWith("sk-")) return "openai";
  return "other";
}
