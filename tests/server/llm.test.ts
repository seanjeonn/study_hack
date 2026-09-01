import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshConfigDir } from "@/tests/helpers/workspace";

// llm.ts memoizes the client and reads MODEL at module load, so every case gets
// its own module registry.
const load = () => import("@/lib/server/llm");

/** Point the config at an empty temp dir, optionally seeding a config.json. */
async function withConfig(config: Record<string, unknown> | null) {
  const dir = freshConfigDir();
  if (config) await fs.writeFile(path.join(dir, "config.json"), JSON.stringify(config));
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getClient", () => {
  it("throws a 503 LlmError when no key is configured", async () => {
    // Stubbed to "" rather than deleted: a dev shell may export a real key.
    vi.stubEnv("OPENAI_API_KEY", "");
    await withConfig(null);
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
    await withConfig(null);
    const { getClient } = await load();
    expect(getClient()).toBe(getClient());
  });

  it("takes the key from the config file over the environment", async () => {
    // The settings form has to win: an OPENAI_API_KEY left in a shell profile
    // must not outrank what the user just typed.
    vi.stubEnv("OPENAI_API_KEY", "sk-from-env");
    await withConfig({ apiKey: "sk-from-config" });
    const { getClient } = await load();
    expect(getClient().apiKey).toBe("sk-from-config");
  });

  it("falls back to the environment when the config has no key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-from-env");
    await withConfig({ telemetryOptIn: true });
    const { getClient } = await load();
    expect(getClient().apiKey).toBe("sk-from-env");
  });

  it("builds a new client when the saved key changes, with no restart", async () => {
    // The regression this file exists for: a plain `let client` would keep
    // serving the old key until the process was restarted.
    vi.stubEnv("OPENAI_API_KEY", "");
    const dir = await withConfig({ apiKey: "sk-one" });
    const { getClient } = await load();
    const first = getClient();
    expect(first.apiKey).toBe("sk-one");

    await fs.writeFile(path.join(dir, "config.json"), JSON.stringify({ apiKey: "sk-two" }));
    const second = getClient();
    expect(second).not.toBe(first);
    expect(second.apiKey).toBe("sk-two");
  });

  it("rebuilds after resetClient even when nothing changed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-stable");
    await withConfig(null);
    const { getClient, resetClient } = await load();
    const first = getClient();
    resetClient();
    expect(getClient()).not.toBe(first);
  });
});

describe("resolveBaseUrl", () => {
  it("routes a beta token at the managed proxy", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("STUDY_PROXY_URL", "https://proxy.example/v1");
    vi.resetModules();
    const { resolveBaseUrl } = await load();
    expect(resolveBaseUrl("sb-beta-0123456789abcdef01234567")).toBe("https://proxy.example/v1");
  });

  it("leaves an OpenAI key on the SDK default", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.resetModules();
    const { resolveBaseUrl } = await load();
    expect(resolveBaseUrl("sk-abc")).toBeUndefined();
  });

  it("lets OPENAI_BASE_URL outrank the proxy routing", async () => {
    // Pointing at Ollama or LM Studio is the documented way to keep every byte
    // local; a token that looks like a beta token must not silently undo it.
    vi.stubEnv("OPENAI_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("STUDY_PROXY_URL", "https://proxy.example/v1");
    vi.resetModules();
    const { resolveBaseUrl } = await load();
    expect(resolveBaseUrl("sb-beta-0123456789abcdef01234567")).toBe("http://localhost:11434/v1");
    expect(resolveBaseUrl("sk-abc")).toBe("http://localhost:11434/v1");
  });

  it("reaches the proxy through the client a beta token builds", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("STUDY_PROXY_URL", "https://proxy.example/v1");
    await withConfig({ apiKey: "sb-beta-0123456789abcdef01234567" });
    const { getClient } = await load();
    expect(getClient().baseURL).toBe("https://proxy.example/v1");
  });
});

describe("asLlmError", () => {
  it("passes an LlmError straight through", async () => {
    const { asLlmError, LlmError } = await load();
    const err = new LlmError(503, "no API key is configured");
    expect(asLlmError(err)).toBe(err);
  });

  it("maps the proxy's quota code to a 429", async () => {
    const { asLlmError, QUOTA_EXHAUSTED_CODE } = await load();
    const { APIError } = await import("openai");
    // The SDK hands APIError the *inner* error object, so `code` lives here.
    const upstream = new APIError(
      429,
      { message: "quota", code: QUOTA_EXHAUSTED_CODE },
      "quota",
      undefined,
    );
    const mapped = asLlmError(upstream);
    expect(mapped?.status).toBe(429);
    expect(mapped?.code).toBe(QUOTA_EXHAUSTED_CODE);
  });

  it("leaves a generic 429 alone so it stays a 502", async () => {
    // An OpenAI rate limit is not "your free beta allowance is gone until the
    // 1st", and must not be shown as if it were.
    const { asLlmError } = await load();
    const { APIError } = await import("openai");
    const upstream = new APIError(
      429,
      { message: "slow down", code: "rate_limit_exceeded" },
      "slow down",
      undefined,
    );
    expect(asLlmError(upstream)).toBeUndefined();
  });

  it("leaves anything unrecognised alone", async () => {
    const { asLlmError } = await load();
    expect(asLlmError(new Error("boom"))).toBeUndefined();
    expect(asLlmError("boom")).toBeUndefined();
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
