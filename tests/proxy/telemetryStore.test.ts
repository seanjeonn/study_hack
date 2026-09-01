import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { TelemetryStore } from "@/proxy/src/telemetryStore";

let dir: string;
const clock = () => new Date("2026-09-15T12:00:00Z");

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "koi-telemetry-"));
});

const store = () => new TelemetryStore(dir, clock);

async function lines(relative: string): Promise<Record<string, unknown>[]> {
  const raw = await fs.readFile(path.join(dir, relative), "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("recordEvent", () => {
  it("appends a valid event to the month's file", async () => {
    const s = store();
    expect(await s.recordEvent({ installId: "i-1", event: "install", version: "0.2.0" })).toEqual({
      ok: true,
    });
    await s.recordEvent({ installId: "i-1", event: "aiUse" });
    const written = await lines("events/2026-09.jsonl");
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({
      installId: "i-1",
      event: "install",
      at: expect.any(String),
    });
  });

  it("rejects an event that does not validate", async () => {
    const s = store();
    expect(await s.recordEvent({ installId: "i-1", event: "wat" })).toEqual({ ok: false });
    expect(await s.recordEvent({ event: "install" })).toEqual({ ok: false });
    expect(await s.recordEvent("nope")).toEqual({ ok: false });
    await expect(fs.readdir(path.join(dir, "events"))).rejects.toThrow();
  });

  it("drops fields that were never part of the schema", async () => {
    // The promise is counts only — a stray `noteText` must not be persisted
    // just because a future client sent it.
    await store().recordEvent({ installId: "i-1", event: "session", noteText: "my private note" });
    const [written] = await lines("events/2026-09.jsonl");
    expect(written).not.toHaveProperty("noteText");
  });
});

describe("recordFakeDoor", () => {
  it("stores a valid answer", async () => {
    await store().recordFakeDoor({ installId: "i-1", answer: "yes", price: "KRW7900" });
    const [written] = await lines("fakedoor.jsonl");
    expect(written).toMatchObject({ valid: true, answer: { answer: "yes" } });
  });

  it("records every allowed answer, dismissal included", async () => {
    const s = store();
    for (const answer of ["yes", "no", "not_sure", "dismissed"]) {
      await s.recordFakeDoor({ installId: "i-1", answer });
    }
    const written = await lines("fakedoor.jsonl");
    expect(written.map((w) => (w.answer as { answer: string }).answer)).toEqual([
      "yes",
      "no",
      "not_sure",
      "dismissed",
    ]);
  });

  it("keeps an answer whose shape it does not recognise", async () => {
    // This arrives once per user and is the number the release exists to
    // measure. Never refuse it over a schema — keep the raw payload instead.
    await store().recordFakeDoor({ answer: "maybe-later", extra: 1 });
    const [written] = await lines("fakedoor.jsonl");
    expect(written.valid).toBe(false);
    expect(written.raw).toEqual({ answer: "maybe-later", extra: 1 });
  });

  it("keeps an answer that is not even an object", async () => {
    await store().recordFakeDoor("yes");
    const [written] = await lines("fakedoor.jsonl");
    expect(written).toMatchObject({ valid: false, raw: "yes" });
  });

  it("appends rather than replacing across store instances", async () => {
    await store().recordFakeDoor({ answer: "yes" });
    await store().recordFakeDoor({ answer: "no" });
    expect(await lines("fakedoor.jsonl")).toHaveLength(2);
  });
});
