import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { monthKey } from "./quota";

/**
 * Append-only JSONL sinks for opt-in usage events and fake-door answers.
 *
 * Append-only because these are observations, not state: nothing here is ever
 * read back by the app, updated, or deleted. One line per event, one file per
 * month, `wc -l` and `jq` are the analytics stack.
 */

/** Nothing legitimate is anywhere near this; the cap is anti-abuse, not a budget. */
export const MAX_EVENT_BYTES = 16 * 1024;

export const UsageEventSchema = z.object({
  /** Anonymous per-install id, or a beta token's owner if one is configured. */
  installId: z.string().min(1).max(100),
  event: z.enum(["install", "session", "aiUse"]),
  version: z.string().max(50).optional(),
  platform: z.string().max(50).optional(),
  locale: z.string().max(20).optional(),
  /** Counts only. Never a note, a filename, or a PDF. */
  noteCount: z.number().int().nonnegative().max(1_000_000).optional(),
  pdfCount: z.number().int().nonnegative().max(1_000_000).optional(),
});

export type UsageEvent = z.infer<typeof UsageEventSchema>;

/**
 * The fake-door answer. Loose on purpose, and the raw payload is kept
 * alongside the parsed fields.
 *
 * This is the one number the whole release exists to measure, and it arrives
 * once per user. Dropping an answer because a field drifted would be losing
 * the actual result to protect a schema.
 */
export const FakeDoorSchema = z.object({
  installId: z.string().min(1).max(100).optional(),
  answer: z.enum(["yes", "no", "not_sure", "dismissed"]),
  price: z.string().max(50).optional(),
  locale: z.string().max(20).optional(),
});

export type FakeDoorAnswer = z.infer<typeof FakeDoorSchema>;

async function appendLine(filePath: string, record: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // A single `appendFile` of a line under the pipe-buffer size is atomic
  // enough for a JSONL log on one process; a temp-file rename would be worse
  // here, since it cannot append.
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export class TelemetryStore {
  constructor(
    private readonly dataDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** `events/<YYYY-MM>.jsonl`. Rejects anything that does not validate. */
  async recordEvent(payload: unknown): Promise<{ ok: boolean }> {
    const parsed = UsageEventSchema.safeParse(payload);
    if (!parsed.success) return { ok: false };
    const file = path.join(this.dataDir, "events", `${monthKey(this.now())}.jsonl`);
    await appendLine(file, { ...parsed.data, at: this.now().toISOString() });
    return { ok: true };
  }

  /**
   * `fakedoor.jsonl` — one file, never rotated, because there will be hundreds
   * of lines at most and they are the point of the experiment.
   *
   * The raw payload is stored next to the parsed one so an answer whose shape
   * we did not anticipate is still recoverable by hand.
   */
  async recordFakeDoor(payload: unknown): Promise<void> {
    const parsed = FakeDoorSchema.safeParse(payload);
    const file = path.join(this.dataDir, "fakedoor.jsonl");
    await appendLine(file, {
      at: this.now().toISOString(),
      valid: parsed.success,
      answer: parsed.success ? parsed.data : undefined,
      raw: payload,
    });
  }
}
