import { describe, expect, it, vi } from "vitest";
import {
  fetchTokenInfo,
  parseAllowedEmails,
  verifyClaims,
  type ClaimsPolicy,
} from "@/proxy/src/googleToken";

const NOW = 1_800_000_000;

/** A tokeninfo payload as Google actually shapes it: numbers and booleans as strings. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: "our-client-id",
    sub: "108",
    email: "Jiwon@Example.com",
    email_verified: "true",
    exp: String(NOW + 3600),
    ...overrides,
  };
}

function policy(overrides: Partial<ClaimsPolicy> = {}): ClaimsPolicy {
  return {
    clientId: "our-client-id",
    allowedEmails: ["jiwon@example.com"],
    maxAccounts: 30,
    accountCount: 0,
    isKnownAccount: false,
    now: NOW,
    ...overrides,
  };
}

describe("verifyClaims", () => {
  it("accepts a good token and lowercases the email it hands back", async () => {
    const result = verifyClaims(payload(), policy());
    expect(result).toEqual({ ok: true, sub: "108", email: "jiwon@example.com" });
  });

  it("accepts the bare-hostname issuer Google also uses", () => {
    expect(verifyClaims(payload({ iss: "accounts.google.com" }), policy()).ok).toBe(true);
  });

  it("401s anything that is not a tokeninfo payload", () => {
    // fetchTokenInfo returns undefined on a non-200 or unreadable body, and
    // that must not read as "no claims to object to".
    expect(verifyClaims(undefined, policy())).toMatchObject({ ok: false, status: 401 });
    expect(verifyClaims({ error: "invalid_token" }, policy())).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("401s a token minted for another application", () => {
    // The whole point of the aud check: anyone can get Google to sign a token,
    // just not one for our client.
    expect(verifyClaims(payload({ aud: "someone-elses-client" }), policy())).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("401s an unexpected issuer", () => {
    expect(verifyClaims(payload({ iss: "https://evil.example" }), policy())).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("401s an expired token, on the second it expires", () => {
    expect(verifyClaims(payload({ exp: String(NOW - 1) }), policy())).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifyClaims(payload({ exp: String(NOW) }), policy())).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifyClaims(payload({ exp: String(NOW + 1) }), policy()).ok).toBe(true);
  });

  it("403s an unverified email", () => {
    // Otherwise anyone could claim any address by putting it on a fresh account.
    expect(verifyClaims(payload({ email_verified: "false" }), policy())).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(verifyClaims(payload({ email_verified: false }), policy())).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("403s an address outside the allowlist", () => {
    expect(verifyClaims(payload({ email: "stranger@example.com" }), policy())).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("refuses everyone when no allowlist is configured", () => {
    // An empty list is the right default for a list whose purpose is to be
    // short — it must not read as "allow all".
    expect(verifyClaims(payload(), policy({ allowedEmails: [] }))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("403s a new account once the beta is full", () => {
    expect(verifyClaims(payload(), policy({ maxAccounts: 2, accountCount: 2 }))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("never turns away an account that is already inside the cap", () => {
    // Refusing someone who already holds a token saves no money and breaks
    // their app the next time the proxy hiccups and they sign in again.
    expect(
      verifyClaims(payload(), policy({ maxAccounts: 2, accountCount: 2, isKnownAccount: true })).ok,
    ).toBe(true);
  });
});

describe("fetchTokenInfo", () => {
  it("asks Google about the token it was given", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("id_token=a.b.c");
      return new Response(JSON.stringify(payload()), { status: 200 });
    });
    const result = await fetchTokenInfo("a.b.c", fetchImpl as unknown as typeof fetch);
    expect(result).toMatchObject({ sub: "108" });
  });

  it("returns undefined when Google refuses the token", async () => {
    const fetchImpl = async () => new Response('{"error":"invalid_token"}', { status: 400 });
    expect(await fetchTokenInfo("bogus", fetchImpl as unknown as typeof fetch)).toBeUndefined();
  });

  it("returns undefined on a body that is not JSON", async () => {
    const fetchImpl = async () => new Response("<html>502</html>", { status: 200 });
    expect(await fetchTokenInfo("a.b.c", fetchImpl as unknown as typeof fetch)).toBeUndefined();
  });
});

describe("parseAllowedEmails", () => {
  it("trims, lowercases, and drops the empties", () => {
    expect(parseAllowedEmails(" A@x.com , b@Y.com ,, ")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("reads an unset variable as an empty list", () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails("")).toEqual([]);
  });
});
