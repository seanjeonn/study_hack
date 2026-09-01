import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWrite } from "./atomicWrite";

/**
 * Per-token monthly request counts, one flat JSON file per calendar month.
 *
 * A month per file means expiry is `rm`, an audit is `cat`, and the rollover
 * needs no scheduled job — the first request in March simply writes
 * `quota/2026-03.json`. No database, matching the rest of the project.
 */

const CountsSchema = z.record(z.string(), z.number().int().nonnegative());

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
}

/** The file key for a date, in UTC so the reset moment is not timezone-dependent. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Decide against a count, without touching the disk. The whole rule, in one
 * pure function: the 60th request of a 60-limit month is allowed and the 61st
 * is not.
 */
export function decide(used: number, limit: number): QuotaDecision {
  return { allowed: used < limit, used, limit };
}

export class QuotaStore {
  /**
   * Every read-modify-write is chained onto this promise.
   *
   * Two concurrent requests from one token would otherwise both read `59`,
   * both write `60`, and the token would get a free request every time it
   * raced itself. One process, one chain, no locking.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private filePath(key: string): string {
    return path.join(this.dataDir, "quota", `${key}.json`);
  }

  /**
   * Read a month's counts. A missing file is a fresh month; a corrupt one is
   * treated as empty and logged — losing a month of counts is survivable,
   * refusing every request because a JSON file got truncated is not.
   */
  private async readCounts(key: string): Promise<Record<string, number>> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath(key), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`[quota] could not read ${key}:`, err);
      }
      return {};
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      console.error(`[quota] ${key}.json is not valid JSON — starting the month from zero`);
      return {};
    }
    const parsed = CountsSchema.safeParse(json);
    if (!parsed.success) {
      console.error(`[quota] ${key}.json did not validate — starting the month from zero`);
      return {};
    }
    return parsed.data;
  }

  /** The current count for a token, without spending any of it. */
  async peek(token: string): Promise<number> {
    const counts = await this.readCounts(monthKey(this.now()));
    return counts[token] ?? 0;
  }

  /**
   * Spend one request if the token has any left.
   *
   * Increments only when it allows: a refused request must not eat quota, or a
   * user who hits the wall keeps being pushed further past it.
   */
  checkAndIncrement(token: string, limit: number): Promise<QuotaDecision> {
    const run = this.chain.then(async () => {
      const key = monthKey(this.now());
      const counts = await this.readCounts(key);
      const used = counts[token] ?? 0;
      const decision = decide(used, limit);
      if (!decision.allowed) return decision;
      counts[token] = used + 1;
      await atomicWrite(this.filePath(key), `${JSON.stringify(counts, null, 2)}\n`);
      return { allowed: true, used: used + 1, limit };
    });
    // Keep the chain alive even if this link rejects, or one failed write
    // would wedge every later request behind it.
    this.chain = run.catch(() => undefined);
    return run;
  }
}
