import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshConfigDir } from "@/tests/helpers/workspace";

const load = () => import("@/lib/server/telemetry");

const BETA_TOKEN = "sb-beta-0123456789abcdef01234567";

/** Point the config at a temp dir, seed it, and stub fetch. */
async function withConfig(config: Record<string, unknown>) {
  const dir = freshConfigDir();
  await fs.writeFile(path.join(dir, "config.json"), JSON.stringify(config));
  // Typed through the generic rather than unused parameters, so the recorded
  // calls keep their shape without tripping no-unused-vars.
  const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(
    async () => new Response(null, { status: 204 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("STUDY_PROXY_URL", "https://proxy.example/v1");
  return { dir, fetchMock, mod: await load() };
}

/** The sends are fire-and-forget; let their microtasks and writes settle. */
const settle = () => new Promise((r) => setTimeout(r, 20));

type FetchCall = [unknown, RequestInit | undefined];

const bodyOf = (call: FetchCall): string => String(call[1]?.body ?? "");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("with telemetry off", () => {
  it("sends nothing at all", async () => {
    const { fetchMock, mod } = await withConfig({ telemetryOptIn: false });
    mod.sendEvent("aiUse");
    mod.sendSessionEvent({ pdfCount: 3 });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not mint an install id or touch the config", async () => {
    // A user who never opts in should have nothing written on their behalf.
    const { dir, mod } = await withConfig({ telemetryOptIn: false });
    mod.sendEvent("aiUse");
    mod.sendSessionEvent();
    await settle();
    const stored = JSON.parse(await fs.readFile(path.join(dir, "config.json"), "utf8"));
    expect(stored).toEqual({ telemetryOptIn: false });
  });

  it("is off by default, with no opt-in field present at all", async () => {
    const { fetchMock, mod } = await withConfig({ apiKey: "sk-abc" });
    mod.sendEvent("aiUse");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("with telemetry on", () => {
  it("posts the event to the proxy's collection endpoint", async () => {
    const { fetchMock, mod } = await withConfig({ telemetryOptIn: true, installId: "i-1" });
    mod.sendEvent("aiUse");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(String(call[0])).toBe("https://proxy.example/t/event");
    expect(JSON.parse(bodyOf(call))).toMatchObject({ installId: "i-1", event: "aiUse" });
  });

  it("mints and persists an install id on the first send", async () => {
    const { dir, fetchMock, mod } = await withConfig({ telemetryOptIn: true });
    mod.sendEvent("aiUse");
    await settle();
    const stored = JSON.parse(await fs.readFile(path.join(dir, "config.json"), "utf8"));
    expect(stored.installId).toEqual(expect.any(String));
    expect(JSON.parse(bodyOf(fetchMock.mock.calls[0] as FetchCall)).installId).toBe(
      stored.installId,
    );
  });

  it("sends a digest of a beta token, never the token", async () => {
    const { fetchMock, mod } = await withConfig({
      telemetryOptIn: true,
      installId: "i-1",
      apiKey: BETA_TOKEN,
    });
    mod.sendEvent("aiUse");
    await settle();
    const body = bodyOf(fetchMock.mock.calls[0] as FetchCall);
    expect(body).not.toContain(BETA_TOKEN);
    expect(JSON.parse(body).betaTokenId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("sends no cohort marker for a BYO OpenAI key", async () => {
    const { fetchMock, mod } = await withConfig({
      telemetryOptIn: true,
      installId: "i-1",
      apiKey: "sk-personal-key",
    });
    mod.sendEvent("aiUse");
    await settle();
    const body = bodyOf(fetchMock.mock.calls[0] as FetchCall);
    expect(body).not.toContain("sk-personal-key");
    expect(JSON.parse(body).betaTokenId).toBeUndefined();
  });

  it("never rejects when the proxy is unreachable", async () => {
    const { mod } = await withConfig({ telemetryOptIn: true, installId: "i-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(() => mod.sendEvent("aiUse")).not.toThrow();
    await settle();
  });
});

describe("sendSessionEvent", () => {
  it("sends install once ever and session once per process", async () => {
    const { dir, fetchMock, mod } = await withConfig({ telemetryOptIn: true, installId: "i-1" });
    mod.resetSessionLatch();

    mod.sendSessionEvent({ pdfCount: 2 });
    await settle();
    const events = fetchMock.mock.calls.map((call) => JSON.parse(bodyOf(call as FetchCall)).event);
    expect(events.sort()).toEqual(["install", "session"]);

    // A navigation back to the library must not re-send either one.
    fetchMock.mockClear();
    mod.sendSessionEvent({ pdfCount: 2 });
    mod.sendSessionEvent({ pdfCount: 2 });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    // The install latch is in the config, so it survives a restart.
    const stored = JSON.parse(await fs.readFile(path.join(dir, "config.json"), "utf8"));
    expect(stored.installEventSent).toBe(true);
  });

  it("skips install when the config says it already went out", async () => {
    const { fetchMock, mod } = await withConfig({
      telemetryOptIn: true,
      installId: "i-1",
      installEventSent: true,
    });
    mod.resetSessionLatch();
    mod.sendSessionEvent();
    await settle();
    const events = fetchMock.mock.calls.map((call) => JSON.parse(bodyOf(call as FetchCall)).event);
    expect(events).toEqual(["session"]);
  });

  it("carries the counts it was given", async () => {
    const { fetchMock, mod } = await withConfig({
      telemetryOptIn: true,
      installId: "i-1",
      installEventSent: true,
    });
    mod.resetSessionLatch();
    mod.sendSessionEvent({ pdfCount: 6, noteCount: 42 });
    await settle();
    expect(JSON.parse(bodyOf(fetchMock.mock.calls[0] as FetchCall))).toMatchObject({
      pdfCount: 6,
      noteCount: 42,
    });
  });
});

describe("concurrent launches", () => {
  it("sends install once even when several requests race", async () => {
    // The sidebar fires /api/pdfs on mount and on every navigation, so three
    // of them land before the config write does. Without the in-process latch
    // all three read installEventSent: false and every one sends.
    const { fetchMock, mod } = await withConfig({ telemetryOptIn: true, installId: "i-1" });
    mod.resetSessionLatch();

    mod.sendSessionEvent();
    mod.sendSessionEvent();
    mod.sendSessionEvent();
    await settle();

    const events = fetchMock.mock.calls.map((call) => JSON.parse(bodyOf(call as FetchCall)).event);
    expect(events.filter((e) => e === "install")).toHaveLength(1);
    expect(events.filter((e) => e === "session")).toHaveLength(1);
  });
});

describe("minting the install id", () => {
  it("mints one id for concurrent sends, and it is the one in the config", async () => {
    // Two events firing at once would otherwise each mint and each write, and
    // one of them would go out tagged with an id no longer stored anywhere.
    const { dir, fetchMock, mod } = await withConfig({ telemetryOptIn: true });
    mod.resetSessionLatch();

    mod.sendEvent("aiUse");
    mod.sendSessionEvent();
    await settle();

    const stored = JSON.parse(await fs.readFile(path.join(dir, "config.json"), "utf8"));
    const ids = fetchMock.mock.calls.map(
      (call) => JSON.parse(bodyOf(call as FetchCall)).installId as string,
    );
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids)).toEqual(new Set([stored.installId]));
  });
});
