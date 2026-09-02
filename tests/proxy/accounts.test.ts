import { mkdtempSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AccountStore, mintToken } from "@/proxy/src/accounts";
import { TOKEN_PATTERN } from "@/proxy/src/tokens";

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), "koi-accounts-"));
}

/** A store whose minted tokens are predictable, so assertions can name them. */
function store(dir: string) {
  let n = 0;
  return new AccountStore(
    dir,
    () => `sb-beta-${String(++n).padStart(24, "0")}`,
    () => new Date("2026-09-02T00:00:00.000Z"),
  );
}

describe("mintToken", () => {
  it("mints tokens the relay already knows how to parse", () => {
    // The pattern is shared with the hand-issued tokens in tokens.json — a
    // mismatch here would be rejected before any lookup happened.
    for (let i = 0; i < 20; i++) expect(mintToken()).toMatch(TOKEN_PATTERN);
  });

  it("does not repeat itself", () => {
    expect(new Set(Array.from({ length: 100 }, mintToken)).size).toBe(100);
  });
});

describe("getOrCreate", () => {
  it("mints once and hands the same token back forever after", async () => {
    // Idempotence is the contract: the app calls this on every sign-in,
    // including the ones that follow a proxy outage.
    const s = store(freshDir());
    const first = await s.getOrCreate("108", "a@example.com");
    const again = await s.getOrCreate("108", "a@example.com");
    expect(again.token).toBe(first.token);
    expect(s.size).toBe(1);
  });

  it("keys on the Google sub, not the email", async () => {
    // An address can be renamed and reassigned; a sub cannot.
    const s = store(freshDir());
    const first = await s.getOrCreate("108", "old@example.com");
    const renamed = await s.getOrCreate("108", "new@example.com");
    expect(renamed.token).toBe(first.token);

    const other = await s.getOrCreate("109", "old@example.com");
    expect(other.token).not.toBe(first.token);
    expect(s.size).toBe(2);
  });

  it("survives a restart", async () => {
    const dir = freshDir();
    const first = await store(dir).getOrCreate("108", "a@example.com");
    const reloaded = new AccountStore(dir);
    await reloaded.load();
    expect(reloaded.get(first.token)).toMatchObject({ token: first.token, label: "a@example.com" });
    expect((await reloaded.getOrCreate("108", "a@example.com")).token).toBe(first.token);
  });

  it("does not let two concurrent sign-ins strand a token", async () => {
    // Two tabs finishing the same sign-in at once would otherwise both mint,
    // and the second write would drop the first token out of the file — after
    // it had already been handed to an app.
    const dir = freshDir();
    const s = store(dir);
    const [a, b] = await Promise.all([
      s.getOrCreate("108", "a@example.com"),
      s.getOrCreate("108", "a@example.com"),
    ]);
    expect(a.token).toBe(b.token);
    expect(s.size).toBe(1);

    const written = JSON.parse(await fs.readFile(path.join(dir, "accounts.json"), "utf8"));
    expect(written.accounts).toHaveLength(1);
  });

  it("keeps every account when several are created at once", async () => {
    const dir = freshDir();
    const s = store(dir);
    await Promise.all(["108", "109", "110"].map((sub) => s.getOrCreate(sub, `${sub}@example.com`)));
    const written = JSON.parse(await fs.readFile(path.join(dir, "accounts.json"), "utf8"));
    expect(written.accounts.map((a: { sub: string }) => a.sub).sort()).toEqual([
      "108",
      "109",
      "110",
    ]);
  });

  it("writes atomically, leaving no temp file behind", async () => {
    const dir = freshDir();
    await store(dir).getOrCreate("108", "a@example.com");
    expect((await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("get", () => {
  it("returns nothing for a token it never issued", async () => {
    const s = store(freshDir());
    await s.getOrCreate("108", "a@example.com");
    expect(s.get("sb-beta-000000000000000000000000")).toBeUndefined();
  });

  it("returns nothing for a revoked account", async () => {
    // Revocation is an edit to accounts.json, the way it is for tokens.json.
    const dir = freshDir();
    writeFileSync(
      path.join(dir, "accounts.json"),
      JSON.stringify({
        accounts: [
          {
            sub: "108",
            token: "sb-beta-0123456789abcdef01234567",
            email: "a@example.com",
            createdAt: "2026-09-02T00:00:00.000Z",
            disabled: true,
          },
        ],
      }),
    );
    const s = new AccountStore(dir);
    await s.load();
    expect(s.get("sb-beta-0123456789abcdef01234567")).toBeUndefined();
    // The row still counts against the cap: it was issued.
    expect(s.size).toBe(1);
  });
});

describe("load", () => {
  it("starts empty when nothing has ever been issued", async () => {
    const s = new AccountStore(freshDir());
    await s.load();
    expect(s.size).toBe(0);
  });

  it("starts empty on a corrupt file rather than refusing to boot", async () => {
    // The relay's operator tokens and the telemetry sink have no reason to go
    // down because this file got truncated.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = freshDir();
    writeFileSync(path.join(dir, "accounts.json"), "{ half a wri");
    const s = new AccountStore(dir);
    await s.load();
    expect(s.size).toBe(0);
    expect(error).toHaveBeenCalled();
  });

  it("starts empty when a row does not carry a usable token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = freshDir();
    writeFileSync(
      path.join(dir, "accounts.json"),
      JSON.stringify({ accounts: [{ sub: "108", token: "nope", email: "", createdAt: "x" }] }),
    );
    const s = new AccountStore(dir);
    await s.load();
    expect(s.size).toBe(0);
    expect(error).toHaveBeenCalled();
  });
});

describe("has", () => {
  it("reports whether a sub is already inside the cap", async () => {
    const s = store(freshDir());
    expect(s.has("108")).toBe(false);
    await s.getOrCreate("108", "a@example.com");
    expect(s.has("108")).toBe(true);
  });
});
