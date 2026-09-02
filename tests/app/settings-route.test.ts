import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freshConfigDir } from "@/tests/helpers/workspace";

/**
 * One route, exercised through its exported handler.
 *
 * The gate is a two-line preamble repeated across twelve route files, and the
 * only thing that can go wrong with it is forgetting it. This pins the shape
 * of a refusal — status and code — on the route that would leak the most if it
 * ever answered signed out: the one that reads and writes the config holding
 * the API key.
 *
 * It is *not* a security boundary. Anything on this machine can call these
 * endpoints. What it enforces is that the app has one front door.
 */
const load = () => import("@/app/api/settings/route");

async function withSession(session: Record<string, unknown> | null) {
  const dir = freshConfigDir();
  if (session) {
    await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(session));
  }
  return load();
}

const SESSION = { sub: "108", email: "a@example.com", signedInAt: "2026-09-02T00:00:00.000Z" };

describe("GET /api/settings", () => {
  it("refuses a signed-out request with the code the client keys off", async () => {
    const route = await withSession(null);
    const res = await route.GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "signed_out" });
  });

  it("answers a signed-in request with the masked view", async () => {
    const route = await withSession(SESSION);
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasKey: false, keyKind: null, telemetryOptIn: false });
  });
});

describe("PUT /api/settings", () => {
  it("refuses a signed-out request before it reads the body", async () => {
    // The gate runs first, so a request that would otherwise have written the
    // config file never gets that far.
    const route = await withSession(null);
    const res = await route.PUT(
      new Request("http://127.0.0.1/api/settings", {
        method: "PUT",
        body: JSON.stringify({ apiKey: "sk-should-never-land" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
