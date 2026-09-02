import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicWrite } from "./atomicWrite";
import {
  BETA_TOKEN_PREFIX,
  DEFAULT_MONTHLY_LIMIT,
  TOKEN_PATTERN,
  type TokenRecord,
} from "./tokens";

/**
 * Tokens issued to Google accounts, in one flat JSON file.
 *
 * The operator's `tokens.json` does not go away — it stays the way to hand
 * someone a token without a Google account, and it is checked first. This file
 * is what sign-in writes: one row per Google `sub`, minted on first sight and
 * handed back unchanged forever after.
 *
 * Keyed on `sub` rather than on the email address, because an email can be
 * renamed and reassigned and a `sub` cannot. The email is stored for the
 * operator's benefit, the way `label` is in `tokens.json`.
 */

export const AccountSchema = z.object({
  sub: z.string().min(1),
  token: z.string().regex(TOKEN_PATTERN),
  email: z.string(),
  createdAt: z.string(),
  /** Revocation without losing the row, matching `tokens.json`. */
  disabled: z.boolean().default(false),
});

export const AccountsFileSchema = z.object({
  accounts: z.array(AccountSchema),
});

export type Account = z.infer<typeof AccountSchema>;

/** `sb-beta-` plus 24 hex, the shape `TOKEN_PATTERN` and the app both expect. */
export function mintToken(): string {
  return `${BETA_TOKEN_PREFIX}${randomBytes(12).toString("hex")}`;
}

export class AccountStore {
  private bySub = new Map<string, Account>();
  private byToken = new Map<string, Account>();

  /**
   * Every read-modify-write is chained onto this promise, the same way
   * `QuotaStore` does it. Two browser tabs finishing the same sign-in at once
   * would otherwise both find no account, both mint one, and the second write
   * would strand the first token — issued, handed to the app, and not in the
   * file any more.
   */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private readonly mint: () => string = mintToken,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get filePath(): string {
    return path.join(this.dataDir, "accounts.json");
  }

  private index(accounts: Account[]): void {
    this.bySub = new Map(accounts.map((a) => [a.sub, a]));
    this.byToken = new Map(accounts.map((a) => [a.token, a]));
  }

  /**
   * Load the file. A missing one is a proxy that has issued nothing yet; a
   * corrupt one starts empty and logs, rather than refusing to boot — the
   * relay's operator tokens and the telemetry sink have no reason to go down
   * because this file got truncated.
   */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[accounts] could not read accounts.json:", err);
      }
      this.index([]);
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      console.error("[accounts] accounts.json is not valid JSON — starting empty");
      this.index([]);
      return;
    }
    const parsed = AccountsFileSchema.safeParse(json);
    if (!parsed.success) {
      console.error("[accounts] accounts.json did not validate — starting empty");
      this.index([]);
      return;
    }
    this.index(parsed.data.accounts);
    console.info(`[accounts] loaded ${this.bySub.size} accounts`);
  }

  /**
   * The token for a Google account, minting one the first time.
   *
   * Idempotent by design: signing in again after a proxy outage has to return
   * the same token, or the app would collect a new one per outage and the quota
   * file would fill with orphans.
   */
  getOrCreate(sub: string, email: string): Promise<Account> {
    const run = this.chain.then(async () => {
      const existing = this.bySub.get(sub);
      if (existing) return existing;
      const account: Account = {
        sub,
        token: this.mint(),
        email,
        createdAt: this.now().toISOString(),
        disabled: false,
      };
      const accounts = [...this.bySub.values(), account];
      await atomicWrite(this.filePath, `${JSON.stringify({ accounts }, null, 2)}\n`);
      this.index(accounts);
      return account;
    });
    // Keep the chain alive even if this link rejects, or one failed write would
    // wedge every later sign-in behind it.
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Look a token up for the relay, in the shape it already understands. The
   * email rides along as the label — it never leaves the server, same as the
   * labels in `tokens.json`.
   */
  get(token: string): TokenRecord | undefined {
    const account = this.byToken.get(token);
    if (!account || account.disabled) return undefined;
    return {
      token: account.token,
      label: account.email,
      monthlyLimit: DEFAULT_MONTHLY_LIMIT,
      disabled: false,
    };
  }

  has(sub: string): boolean {
    return this.bySub.has(sub);
  }

  get size(): number {
    return this.bySub.size;
  }
}
