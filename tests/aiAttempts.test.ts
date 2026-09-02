import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_DOOR_THRESHOLD,
  fakeDoorShown,
  getInstallId,
  markFakeDoorShown,
  parseCount,
  readAttempts,
  recordAttempt,
  shouldShowFakeDoor,
} from "@/lib/aiAttempts";

/** A minimal localStorage; `broken` makes every access throw. */
function stubStorage(broken = false) {
  const store = new Map<string, string>();
  const throwIfBroken = () => {
    if (broken) throw new Error("storage is disabled");
  };
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (throwIfBroken(), store.get(k) ?? null),
      setItem: (k: string, v: string) => (throwIfBroken(), void store.set(k, v)),
    },
    crypto: { randomUUID: () => "11111111-2222-3333-4444-555555555555" },
  });
  return store;
}

beforeEach(() => stubStorage());
afterEach(() => vi.unstubAllGlobals());

describe("parseCount", () => {
  it("reads a decimal count", () => {
    expect(parseCount("0")).toBe(0);
    expect(parseCount("7")).toBe(7);
  });

  it("treats anything else as zero", () => {
    // Another tab, an extension, or a hand edit can put anything in there.
    for (const bad of [null, "", "-1", "3.5", "abc", "1e3", " 2"]) {
      expect(parseCount(bad), String(bad)).toBe(0);
    }
  });
});

describe("shouldShowFakeDoor", () => {
  it("asks on the third attempt, not the first", () => {
    expect(shouldShowFakeDoor(1, false)).toBe(false);
    expect(shouldShowFakeDoor(2, false)).toBe(false);
    expect(shouldShowFakeDoor(FAKE_DOOR_THRESHOLD, false)).toBe(true);
  });

  it("never asks twice", () => {
    expect(shouldShowFakeDoor(3, true)).toBe(false);
    expect(shouldShowFakeDoor(99, true)).toBe(false);
  });
});

describe("recordAttempt", () => {
  it("counts up and persists", () => {
    expect(recordAttempt()).toBe(1);
    expect(recordAttempt()).toBe(2);
    expect(readAttempts()).toBe(2);
  });

  it("drives the dialog on the third press and never again", () => {
    const shown: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const show = shouldShowFakeDoor(recordAttempt(), fakeDoorShown());
      if (show) markFakeDoorShown();
      shown.push(show);
    }
    expect(shown).toEqual([false, false, true, false, false, false]);
  });
});

describe("getInstallId", () => {
  it("mints once and reuses it", () => {
    const first = getInstallId();
    expect(first).toBe("11111111-2222-3333-4444-555555555555");
    expect(getInstallId()).toBe(first);
  });
});

describe("with storage disabled", () => {
  beforeEach(() => stubStorage(true));

  it("never throws — losing a measurement beats losing the user's note", () => {
    expect(() => recordAttempt()).not.toThrow();
    expect(() => markFakeDoorShown()).not.toThrow();
    expect(readAttempts()).toBe(0);
    expect(getInstallId()).toBe("anonymous");
  });

  it("assumes the dialog was already shown, so it cannot repeat every press", () => {
    expect(fakeDoorShown()).toBe(true);
    expect(shouldShowFakeDoor(readAttempts(), fakeDoorShown())).toBe(false);
  });
});
