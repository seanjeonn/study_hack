import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { freshConfigDir } from "@/tests/helpers/workspace";

// PENDING_AUTH_PATH is derived from CONFIG_DIR at module load, so the module
// under test has to be imported after freshConfigDir().
const load = () => import("@/lib/server/oauth");

async function fresh() {
  const dir = freshConfigDir();
  return { dir, mod: await load() };
}

describe("newPkce", () => {
  it("produces a verifier RFC 7636 accepts, and its S256 challenge", async () => {
    const { mod } = await fresh();
    const { state, verifier, challenge } = mod.newPkce();

    // base64url only, and inside the spec's 43..128 characters.
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("never repeats a state", async () => {
    const { mod } = await fresh();
    const states = new Set(Array.from({ length: 50 }, () => mod.newPkce().state));
    expect(states.size).toBe(50);
  });
});

describe("buildAuthUrl", () => {
  it("asks for the three scopes that need no verification review", async () => {
    const { mod } = await fresh();
    const url = new URL(
      mod.buildAuthUrl({
        clientId: "cid",
        redirectUri: "http://127.0.0.1:3210/api/auth/callback",
        state: "st",
        challenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe(mod.AUTH_ENDPOINT);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3210/api/auth/callback");
  });
});

describe("savePending / consumePending", () => {
  const pending = {
    state: "st",
    verifier: "vf",
    // The port is whatever was free at launch, which is exactly why this is
    // stored rather than rebuilt at the callback.
    redirectUri: "http://127.0.0.1:3210/api/auth/callback",
    createdAt: 1_000_000,
  };

  it("gives the redirect URI back byte for byte", async () => {
    // Google compares the two legs' redirect_uri exactly — localhost vs
    // 127.0.0.1, or a different port on a retry, is how sign-in silently fails.
    const { mod } = await fresh();
    await mod.savePending(pending);
    expect(await mod.consumePending("st", 1_000_000)).toEqual(pending);
  });

  it("can only be consumed once", async () => {
    const { mod } = await fresh();
    await mod.savePending(pending);
    expect(await mod.consumePending("st", 1_000_000)).not.toBeNull();
    expect(await mod.consumePending("st", 1_000_000)).toBeNull();
  });

  it("refuses a state that does not match, and burns the slot doing it", async () => {
    const { mod } = await fresh();
    await mod.savePending(pending);
    expect(await mod.consumePending("someone-elses-state", 1_000_000)).toBeNull();
    // The file is gone either way: a callback that guessed wrong does not get
    // to keep guessing.
    expect(await mod.consumePending("st", 1_000_000)).toBeNull();
  });

  it("expires after the TTL", async () => {
    const { mod } = await fresh();
    await mod.savePending(pending);
    expect(await mod.consumePending("st", 1_000_000 + mod.PENDING_TTL_MS + 1)).toBeNull();
  });

  it("still honours a sign-in right on the TTL boundary", async () => {
    const { mod } = await fresh();
    await mod.savePending(pending);
    expect(await mod.consumePending("st", 1_000_000 + mod.PENDING_TTL_MS)).not.toBeNull();
  });

  it("replaces the previous attempt rather than accumulating", async () => {
    const { mod } = await fresh();
    await mod.savePending(pending);
    await mod.savePending({ ...pending, state: "second", verifier: "vf2" });
    expect(await mod.consumePending("st", 1_000_000)).toBeNull();
  });

  it("treats a corrupt slot as nothing pending", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { dir, mod } = await fresh();
    await fs.writeFile(path.join(dir, "pending-auth.json"), "{ not json");
    expect(await mod.consumePending("st")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("reads nothing when no sign-in was started", async () => {
    const { mod } = await fresh();
    expect(await mod.consumePending("st")).toBeNull();
  });
});

describe("exchangeCode", () => {
  const params = {
    code: "auth-code",
    verifier: "vf",
    redirectUri: "http://127.0.0.1:3210/api/auth/callback",
    clientId: "cid",
    clientSecret: "secret",
  };

  it("posts the verifier and the same redirect URI, and returns the id_token", async () => {
    const { mod } = await fresh();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("code_verifier")).toBe("vf");
      expect(body.get("redirect_uri")).toBe(params.redirectUri);
      expect(body.get("grant_type")).toBe("authorization_code");
      return new Response(JSON.stringify({ id_token: "jwt" }), { status: 200 });
    });
    expect(await mod.exchangeCode(params, fetchImpl as unknown as typeof fetch)).toBe("jwt");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on a refusal from Google", async () => {
    const { mod } = await fresh();
    const fetchImpl = async () => new Response('{"error":"invalid_grant"}', { status: 400 });
    await expect(mod.exchangeCode(params, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /400/,
    );
  });

  it("throws when the response carries no id_token", async () => {
    const { mod } = await fresh();
    const fetchImpl = async () => new Response('{"access_token":"at"}', { status: 200 });
    await expect(mod.exchangeCode(params, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /id_token/,
    );
  });
});

describe("decodeIdToken", () => {
  function jwt(payload: unknown): string {
    const part = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `header.${part}.signature`;
  }

  it("reads the claims the app stores", async () => {
    const { mod } = await fresh();
    expect(
      mod.decodeIdToken(
        jwt({ sub: "108", email: "a@b.c", name: "지원", picture: "https://p", extra: 1 }),
      ),
    ).toEqual({ sub: "108", email: "a@b.c", name: "지원", picture: "https://p" });
  });

  it("leaves the optional claims undefined rather than guessing", async () => {
    const { mod } = await fresh();
    expect(mod.decodeIdToken(jwt({ sub: "108", email: "a@b.c" }))).toEqual({
      sub: "108",
      email: "a@b.c",
      name: undefined,
      picture: undefined,
    });
  });

  it("rejects a token with no identity in it", async () => {
    const { mod } = await fresh();
    expect(() => mod.decodeIdToken(jwt({ email: "a@b.c" }))).toThrow(/sub/);
    expect(() => mod.decodeIdToken(jwt({ sub: "108" }))).toThrow(/email/);
    expect(() => mod.decodeIdToken("not-a-jwt")).toThrow();
  });
});
