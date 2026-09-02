import fs from "node:fs";
import { z } from "zod";

/**
 * Beta tokens, read from a flat JSON file.
 *
 * There is no database and no signup: issuing a token is editing `tokens.json`
 * and sending SIGHUP. At the scale this exists for — a few dozen students for
 * one exam season — that is the whole product, and anything more would be
 * infrastructure built for a user count we have not earned yet.
 */

/** The prefix that tells a beta token apart from an OpenAI key at a glance. */
export const BETA_TOKEN_PREFIX = "sb-beta-";

export const TOKEN_PATTERN = /^sb-beta-[0-9a-f]{24}$/;

/** Requests a token may make in a calendar month, unless it says otherwise. */
export const DEFAULT_MONTHLY_LIMIT = 60;

const TokenRecordSchema = z.object({
  token: z.string().regex(TOKEN_PATTERN),
  /** Free text for the operator: who this went to. Never leaves the server. */
  label: z.string().default(""),
  monthlyLimit: z.number().int().positive().max(100_000).default(DEFAULT_MONTHLY_LIMIT),
  /** Revocation without deleting the row, so the label survives. */
  disabled: z.boolean().default(false),
});

export const TokensFileSchema = z.object({
  tokens: z.array(TokenRecordSchema),
});

export type TokenRecord = z.infer<typeof TokenRecordSchema>;

/**
 * Parse the file contents into a lookup. Throws on anything malformed — the
 * caller decides whether to keep the previous set (a reload) or refuse to
 * start (boot).
 */
export function parseTokens(raw: string): Map<string, TokenRecord> {
  const parsed = TokensFileSchema.parse(JSON.parse(raw));
  const byToken = new Map<string, TokenRecord>();
  for (const record of parsed.tokens) {
    if (byToken.has(record.token)) {
      throw new Error(`duplicate token in tokens.json: ${record.token.slice(0, 16)}…`);
    }
    byToken.set(record.token, record);
  }
  return byToken;
}

/**
 * The live token set, reloadable on SIGHUP.
 *
 * A failed reload keeps the previous set on purpose: a typo saved into
 * tokens.json at 2am should not revoke everyone's access. It logs loudly
 * instead.
 */
export class TokenStore {
  private byToken = new Map<string, TokenRecord>();

  constructor(private readonly filePath: string) {}

  /** Load for the first time. Throws — a proxy with no tokens is not useful. */
  loadOrThrow(): void {
    this.byToken = parseTokens(fs.readFileSync(this.filePath, "utf8"));
    console.info(`[tokens] loaded ${this.byToken.size} tokens from ${this.filePath}`);
  }

  /** Reload after a SIGHUP. Keeps the previous set if the new file is broken. */
  reload(): void {
    try {
      this.byToken = parseTokens(fs.readFileSync(this.filePath, "utf8"));
      console.info(`[tokens] reloaded ${this.byToken.size} tokens`);
    } catch (err) {
      console.error("[tokens] reload failed — keeping the previous set:", err);
    }
  }

  /** The record for an active token, or undefined for unknown or revoked. */
  get(token: string): TokenRecord | undefined {
    const record = this.byToken.get(token);
    return record && !record.disabled ? record : undefined;
  }

  get size(): number {
    return this.byToken.size;
  }
}
