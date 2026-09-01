import { afterEach, describe, expect, it, vi } from "vitest";

// llm.ts memoizes the client and reads MODEL at module load, so every case gets
// its own module registry.
const load = () => import("@/lib/server/llm");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getClient", () => {
  it("throws a 503 LlmError when no key is configured", async () => {
    // Stubbed to "" rather than deleted: a dev shell may export a real key.
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.resetModules();
    const { LlmError, getClient } = await load();
    try {
      getClient();
      expect.unreachable("getClient should have thrown");
    } catch (err) {
      // The class identity differs across module resets — compare against the
      // LlmError from this same import.
      expect(err).toBeInstanceOf(LlmError);
      expect((err as InstanceType<typeof LlmError>).status).toBe(503);
    }
  });

  it("memoizes the client, and constructs it without a network call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-a-real-key");
    vi.resetModules();
    const { getClient } = await load();
    expect(getClient()).toBe(getClient());
  });
});

describe("MODEL", () => {
  it("defaults to gpt-5-mini", async () => {
    vi.stubEnv("OPENAI_MODEL", undefined);
    vi.stubEnv("OPENAI_VISION_MODEL", undefined);
    vi.resetModules();
    const { MODEL, VISION_MODEL } = await load();
    expect(MODEL).toBe("gpt-5-mini");
    expect(VISION_MODEL).toBe("gpt-5-mini");
  });

  it("takes the env override, read once at module load", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-test");
    vi.stubEnv("OPENAI_VISION_MODEL", "gpt-vision-test");
    vi.resetModules();
    const { MODEL, VISION_MODEL } = await load();
    expect(MODEL).toBe("gpt-test");
    expect(VISION_MODEL).toBe("gpt-vision-test");

    // Changing the env afterwards does not move it — the value is bound at load.
    vi.stubEnv("OPENAI_MODEL", "gpt-changed");
    expect((await load()).MODEL).toBe("gpt-test");
  });
});
