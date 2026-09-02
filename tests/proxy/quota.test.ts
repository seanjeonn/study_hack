import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decide, monthKey, QuotaStore } from "@/proxy/src/quota";

const TOKEN = "sb-beta-0123456789abcdef01234567";
const OTHER = "sb-beta-fedcba9876543210fedcba98";

let dir: string;
let clock: Date;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "koi-quota-"));
  clock = new Date("2026-09-15T12:00:00Z");
});

const store = () => new QuotaStore(dir, () => clock);

describe("monthKey", () => {
  it("keys by UTC month, so the reset moment is not timezone-dependent", () => {
    expect(monthKey(new Date("2026-09-15T12:00:00Z"))).toBe("2026-09");
    expect(monthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    // 23:30 UTC on the 30th is already October in Seoul; the file is still
    // September's, which is what makes the count reproducible.
    expect(monthKey(new Date("2026-09-30T23:30:00Z"))).toBe("2026-09");
  });
});

describe("decide", () => {
  it("allows the last request of the allowance and refuses the next", () => {
    expect(decide(58, 60).allowed).toBe(true);
    expect(decide(59, 60).allowed).toBe(true);
    expect(decide(60, 60).allowed).toBe(false);
    expect(decide(61, 60).allowed).toBe(false);
  });
});

describe("checkAndIncrement", () => {
  it("counts up to the limit and then refuses", async () => {
    const q = store();
    for (let i = 1; i <= 60; i++) {
      const decision = await q.checkAndIncrement(TOKEN, 60);
      expect(decision.allowed, `request ${i}`).toBe(true);
      expect(decision.used).toBe(i);
    }
    const over = await q.checkAndIncrement(TOKEN, 60);
    expect(over.allowed).toBe(false);
    expect(over.used).toBe(60);
  });

  it("does not spend quota on a refused request", async () => {
    // Otherwise a user who hits the wall keeps being pushed further past it,
    // and the count no longer means "requests served".
    const q = store();
    await q.checkAndIncrement(TOKEN, 1);
    await q.checkAndIncrement(TOKEN, 1);
    await q.checkAndIncrement(TOKEN, 1);
    expect(await q.peek(TOKEN)).toBe(1);
  });

  it("keeps tokens isolated from each other", async () => {
    const q = store();
    await q.checkAndIncrement(TOKEN, 2);
    await q.checkAndIncrement(TOKEN, 2);
    const other = await q.checkAndIncrement(OTHER, 2);
    expect(other.allowed).toBe(true);
    expect(other.used).toBe(1);
    expect((await q.checkAndIncrement(TOKEN, 2)).allowed).toBe(false);
  });

  it("rolls over at the month boundary", async () => {
    const q = store();
    await q.checkAndIncrement(TOKEN, 1);
    expect((await q.checkAndIncrement(TOKEN, 1)).allowed).toBe(false);

    clock = new Date("2026-10-01T00:00:00Z");
    const fresh = await q.checkAndIncrement(TOKEN, 1);
    expect(fresh.allowed).toBe(true);
    expect(fresh.used).toBe(1);
    // September's file is left intact for the record.
    expect(await q.peek(TOKEN)).toBe(1);
    const september = JSON.parse(
      await fs.readFile(path.join(dir, "quota", "2026-09.json"), "utf8"),
    );
    expect(september[TOKEN]).toBe(1);
  });

  it("serializes concurrent requests from one token", async () => {
    // Without the promise chain both reads see the same count and the token
    // gets a free request every time it races itself.
    const q = store();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => q.checkAndIncrement(TOKEN, 5)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(await q.peek(TOKEN)).toBe(5);
  });

  it("starts the month from zero when the file is corrupt", async () => {
    // Refusing every request because a JSON file got truncated is worse than
    // losing a month of counts.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await fs.mkdir(path.join(dir, "quota"), { recursive: true });
    await fs.writeFile(path.join(dir, "quota", "2026-09.json"), "{ truncated");
    const decision = await store().checkAndIncrement(TOKEN, 60);
    expect(decision.allowed).toBe(true);
    expect(error).toHaveBeenCalled();
  });

  it("starts the month from zero when the shape is wrong", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await fs.mkdir(path.join(dir, "quota"), { recursive: true });
    await fs.writeFile(path.join(dir, "quota", "2026-09.json"), JSON.stringify([1, 2, 3]));
    expect((await store().checkAndIncrement(TOKEN, 60)).allowed).toBe(true);
    expect(error).toHaveBeenCalled();
  });

  it("leaves no temp files behind", async () => {
    const q = store();
    await q.checkAndIncrement(TOKEN, 60);
    const entries = await fs.readdir(path.join(dir, "quota"));
    expect(entries).toEqual(["2026-09.json"]);
  });
});
