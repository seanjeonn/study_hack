import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MONTHLY_LIMIT, parseTokens, TokenStore } from "@/proxy/src/tokens";

const TOKEN = "sb-beta-0123456789abcdef01234567";
const OTHER = "sb-beta-fedcba9876543210fedcba98";

const file = (contents: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), "koi-tokens-"));
  const filePath = path.join(dir, "tokens.json");
  writeFileSync(filePath, contents);
  return filePath;
};

describe("parseTokens", () => {
  it("applies the defaults a hand-written row omits", () => {
    const map = parseTokens(JSON.stringify({ tokens: [{ token: TOKEN }] }));
    expect(map.get(TOKEN)).toEqual({
      token: TOKEN,
      label: "",
      monthlyLimit: DEFAULT_MONTHLY_LIMIT,
      disabled: false,
    });
  });

  it("rejects a token that is not in the beta shape", () => {
    expect(() => parseTokens(JSON.stringify({ tokens: [{ token: "sk-abc" }] }))).toThrow();
    expect(() => parseTokens(JSON.stringify({ tokens: [{ token: "sb-beta-XYZ" }] }))).toThrow();
  });

  it("rejects a duplicate token", () => {
    // Two rows for one token means one silently wins; issuing is a hand edit,
    // so this is a realistic mistake and a confusing one to debug live.
    const raw = JSON.stringify({ tokens: [{ token: TOKEN }, { token: TOKEN, monthlyLimit: 999 }] });
    expect(() => parseTokens(raw)).toThrow(/duplicate/);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseTokens("{ nope")).toThrow();
  });
});

describe("TokenStore", () => {
  it("looks up an active token and hides a disabled one", () => {
    const store = new TokenStore(
      file(JSON.stringify({ tokens: [{ token: TOKEN }, { token: OTHER, disabled: true }] })),
    );
    store.loadOrThrow();
    expect(store.get(TOKEN)?.token).toBe(TOKEN);
    expect(store.get(OTHER)).toBeUndefined();
    expect(store.get("sb-beta-000000000000000000000000")).toBeUndefined();
    // A revoked row still counts as loaded — the label is the operator's record.
    expect(store.size).toBe(2);
  });

  it("keeps the previous set when a reload is broken", () => {
    // A typo saved into tokens.json at 2am must not revoke everyone.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const filePath = file(JSON.stringify({ tokens: [{ token: TOKEN }] }));
    const store = new TokenStore(filePath);
    store.loadOrThrow();

    writeFileSync(filePath, "{ broken");
    store.reload();
    expect(store.get(TOKEN)?.token).toBe(TOKEN);
    expect(error).toHaveBeenCalled();
  });

  it("picks up a new token on reload", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const filePath = file(JSON.stringify({ tokens: [{ token: TOKEN }] }));
    const store = new TokenStore(filePath);
    store.loadOrThrow();
    expect(store.get(OTHER)).toBeUndefined();

    writeFileSync(filePath, JSON.stringify({ tokens: [{ token: TOKEN }, { token: OTHER }] }));
    store.reload();
    expect(store.get(OTHER)?.token).toBe(OTHER);
  });

  it("refuses to start on a broken file", () => {
    const store = new TokenStore(file("{ broken"));
    expect(() => store.loadOrThrow()).toThrow();
  });
});
