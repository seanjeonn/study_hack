import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { freshConfigDir } from "@/tests/helpers/workspace";

// CONFIG_DIR is resolved at module load, so the module under test has to be
// imported after freshConfigDir() — see tests/helpers/workspace.ts.
const load = () => import("@/lib/server/session");

async function withSession(contents: string | null) {
  const dir = freshConfigDir();
  if (contents !== null) {
    await fs.writeFile(path.join(dir, "session.json"), contents);
  }
  return { dir, mod: await load() };
}

const SESSION = {
  sub: "108…",
  email: "jiwon@example.com",
  name: "지원",
  signedInAt: "2026-09-02T00:00:00.000Z",
};

describe("readSession", () => {
  it("reads nothing when there is no session file", async () => {
    const { mod } = await withSession(null);
    expect(await mod.readSession()).toBeNull();
  });

  it("reads a stored session back", async () => {
    const { mod } = await withSession(JSON.stringify(SESSION));
    expect(await mod.readSession()).toEqual(SESSION);
  });

  it("treats unparseable JSON as signed out rather than throwing", async () => {
    // The file sits in a directory the user can open; a broken one must cost
    // them one trip through Google, not a 500 on every page.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { mod } = await withSession("{ half a wri");
    expect(await mod.readSession()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("treats a session missing its email as signed out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { mod } = await withSession(JSON.stringify({ sub: "108", signedInAt: "now" }));
    expect(await mod.readSession()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("reads fresh from disk on every call", async () => {
    // Sign-in writes this file from another request; a memoized read is how
    // "I signed in and it still says signed out" happens.
    const { dir, mod } = await withSession(null);
    expect(await mod.readSession()).toBeNull();
    await fs.writeFile(path.join(dir, "session.json"), JSON.stringify(SESSION));
    expect(await mod.readSession()).toEqual(SESSION);
  });
});

describe("writeSession / clearSession", () => {
  it("round-trips a session and leaves no temp file behind", async () => {
    const { dir, mod } = await withSession(null);
    await mod.writeSession(SESSION);
    expect(await mod.readSession()).toEqual(SESSION);
    expect((await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses to persist a session with no identity in it", async () => {
    const { mod } = await withSession(null);
    await expect(
      mod.writeSession({ sub: "", email: "a@b.c", signedInAt: "now" }),
    ).rejects.toThrow();
    expect(await mod.readSession()).toBeNull();
  });

  it("clears a session, and clearing again is not an error", async () => {
    const { mod } = await withSession(JSON.stringify(SESSION));
    await mod.clearSession();
    expect(await mod.readSession()).toBeNull();
    await expect(mod.clearSession()).resolves.toBeUndefined();
  });
});

describe("denyIfSignedOut", () => {
  it("hands back a 401 carrying the code the client keys off", async () => {
    const { mod } = await withSession(null);
    const denied = await mod.denyIfSignedOut();
    expect(denied?.status).toBe(401);
    expect(await denied?.json()).toEqual({ error: "sign in first", code: "signed_out" });
  });

  it("waves a signed-in request through", async () => {
    const { mod } = await withSession(JSON.stringify(SESSION));
    expect(await mod.denyIfSignedOut()).toBeNull();
  });
});
