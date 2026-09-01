import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshConfigDir } from "@/tests/helpers/workspace";

const load = () => import("@/lib/server/config");

async function withConfig(contents: string | null) {
  const dir = freshConfigDir();
  if (contents !== null) {
    await fs.writeFile(path.join(dir, "config.json"), contents);
  }
  return { dir, mod: await load() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readConfig", () => {
  it("returns defaults when the file does not exist", async () => {
    const { mod } = await withConfig(null);
    expect(mod.readConfig()).toEqual({ telemetryOptIn: false, installEventSent: false });
  });

  it("reads a saved config back", async () => {
    const { mod } = await withConfig(
      JSON.stringify({ apiKey: "sk-abc", telemetryOptIn: true, installId: "i-1" }),
    );
    expect(mod.readConfig()).toEqual({
      apiKey: "sk-abc",
      telemetryOptIn: true,
      installId: "i-1",
      installEventSent: false,
    });
  });

  it("falls back to defaults on unparseable JSON rather than throwing", async () => {
    // The file is hand-editable, and a broken one must never take down a
    // request — least of all the reader, which needs no key at all.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { mod } = await withConfig("{ this is not json");
    expect(mod.readConfig()).toEqual({ telemetryOptIn: false, installEventSent: false });
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to defaults when the shape is wrong", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { mod } = await withConfig(JSON.stringify({ telemetryOptIn: "yes please" }));
    expect(mod.readConfig()).toEqual({ telemetryOptIn: false, installEventSent: false });
    expect(warn).toHaveBeenCalled();
  });

  it("never defaults the telemetry opt-in to true", async () => {
    const { mod } = await withConfig(JSON.stringify({ apiKey: "sk-abc" }));
    expect(mod.readConfig().telemetryOptIn).toBe(false);
  });

  it("reads fresh from disk on every call", async () => {
    // The settings route writes this file mid-process; a memoized read is
    // exactly how "I saved my key and it still says no key" happens.
    const { dir, mod } = await withConfig(JSON.stringify({ apiKey: "sk-one" }));
    expect(mod.readConfig().apiKey).toBe("sk-one");
    await fs.writeFile(path.join(dir, "config.json"), JSON.stringify({ apiKey: "sk-two" }));
    expect(mod.readConfig().apiKey).toBe("sk-two");
  });
});

describe("updateConfig", () => {
  it("merges into the stored config instead of replacing it", async () => {
    const { mod } = await withConfig(JSON.stringify({ apiKey: "sk-abc", installId: "i-1" }));
    const next = await mod.updateConfig({ telemetryOptIn: true });
    expect(next).toEqual({
      apiKey: "sk-abc",
      installId: "i-1",
      telemetryOptIn: true,
      installEventSent: false,
    });
    expect(mod.readConfig()).toEqual(next);
  });

  it("treats an empty apiKey as a removal", async () => {
    const { mod } = await withConfig(JSON.stringify({ apiKey: "sk-abc", telemetryOptIn: true }));
    const next = await mod.updateConfig({ apiKey: "" });
    expect(next.apiKey).toBeUndefined();
    expect(next.telemetryOptIn).toBe(true);
    expect(mod.readConfig().apiKey).toBeUndefined();
  });

  it("ignores undefined fields rather than clearing them", async () => {
    const { mod } = await withConfig(JSON.stringify({ apiKey: "sk-abc" }));
    await mod.updateConfig({ apiKey: undefined, telemetryOptIn: true });
    expect(mod.readConfig().apiKey).toBe("sk-abc");
  });

  it("creates the config directory when it is missing", async () => {
    const dir = path.join(freshConfigDir(), "nested", "deeper");
    process.env.STUDY_CONFIG_DIR = dir;
    vi.resetModules();
    const mod = await load();
    await mod.updateConfig({ apiKey: "sk-new" });
    expect(mod.readConfig().apiKey).toBe("sk-new");
  });

  it("writes valid JSON, not a torn file", async () => {
    const { dir, mod } = await withConfig(null);
    await mod.updateConfig({ apiKey: "sk-abc", telemetryOptIn: true });
    const raw = await fs.readFile(path.join(dir, "config.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ apiKey: "sk-abc", telemetryOptIn: true });
    // atomicWrite renames a temp file into place — nothing should be left over.
    expect((await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
