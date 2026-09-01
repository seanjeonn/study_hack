import { describe, expect, it, vi } from "vitest";
import {
  bearerToken,
  PINNED_MODEL,
  QUOTA_EXHAUSTED_CODE,
  relay,
  type RelayDeps,
} from "@/proxy/src/relay";
import { DEFAULT_MONTHLY_LIMIT, type TokenRecord } from "@/proxy/src/tokens";

const TOKEN = "sb-beta-0123456789abcdef01234567";
const AUTH = `Bearer ${TOKEN}`;

const record: TokenRecord = {
  token: TOKEN,
  label: "tester",
  monthlyLimit: DEFAULT_MONTHLY_LIMIT,
  disabled: false,
};

function deps(overrides: Partial<RelayDeps> = {}): RelayDeps {
  return {
    disabled: false,
    getToken: (t) => (t === TOKEN ? record : undefined),
    checkQuota: async (_t, limit) => ({ allowed: true, used: 1, limit }),
    forward: async (body) => ({ status: 200, body: { echo: body } }),
    ...overrides,
  };
}

const body = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };

describe("bearerToken", () => {
  it("accepts a well-formed beta token", () => {
    expect(bearerToken(AUTH)).toBe(TOKEN);
    expect(bearerToken(`bearer  ${TOKEN}  `)).toBe(TOKEN);
  });

  it("refuses an OpenAI key outright", () => {
    // Someone mispasting their real sk- key into a field pointed at us should
    // get a 401, not have it forwarded anywhere.
    expect(bearerToken("Bearer sk-proj-realkey")).toBeUndefined();
  });

  it("refuses a malformed or absent header", () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken("")).toBeUndefined();
    expect(bearerToken(TOKEN)).toBeUndefined();
    expect(bearerToken("Bearer sb-beta-SHORT")).toBeUndefined();
    expect(bearerToken(`Bearer ${TOKEN} extra`)).toBeUndefined();
  });
});

describe("relay", () => {
  it("forwards a valid request", async () => {
    const result = await relay({ authorization: AUTH, body }, deps());
    expect(result.status).toBe(200);
    expect(result.passthrough).toBe(true);
  });

  it("overrides the model no matter what was asked for", async () => {
    // The token is in the user's hands: `curl` with "model": "gpt-5" against a
    // free beta would be someone else's bill.
    const forward = vi.fn(async () => ({ status: 200, body: {} }));
    await relay({ authorization: AUTH, body: { ...body, model: "gpt-5" } }, deps({ forward }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ model: PINNED_MODEL }));
  });

  it("pins the model even when none was sent", async () => {
    const forward = vi.fn(async () => ({ status: 200, body: {} }));
    await relay({ authorization: AUTH, body: { messages: [] } }, deps({ forward }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ model: PINNED_MODEL }));
  });

  it("401s an unknown or revoked token without spending quota", async () => {
    const checkQuota = vi.fn();
    const result = await relay(
      { authorization: "Bearer sb-beta-ffffffffffffffffffffffff", body },
      deps({ checkQuota }),
    );
    expect(result.status).toBe(401);
    expect(checkQuota).not.toHaveBeenCalled();
  });

  it("401s a missing token", async () => {
    expect((await relay({ body }, deps())).status).toBe(401);
  });

  it("503s when the kill switch is on, before reading any quota", async () => {
    // Turning the relay off must cost nothing and must not be wearable down
    // by traffic.
    const checkQuota = vi.fn();
    const result = await relay({ authorization: AUTH, body }, deps({ disabled: true, checkQuota }));
    expect(result.status).toBe(503);
    expect(checkQuota).not.toHaveBeenCalled();
  });

  it("429s with the exact code the app maps to its quota message", async () => {
    const result = await relay(
      { authorization: AUTH, body },
      deps({ checkQuota: async () => ({ allowed: false, used: 60, limit: 60 }) }),
    );
    expect(result.status).toBe(429);
    // The app keys its localized message off this code, so the shape is a
    // contract, not a detail.
    expect(result.body).toMatchObject({
      error: { code: QUOTA_EXHAUSTED_CODE, type: "insufficient_quota" },
    });
    expect((result.body as { error: { message: string } }).error.message).toContain("60");
  });

  it("does not forward once the quota is gone", async () => {
    const forward = vi.fn(async () => ({ status: 200, body: {} }));
    await relay(
      { authorization: AUTH, body },
      deps({ checkQuota: async () => ({ allowed: false, used: 60, limit: 60 }), forward }),
    );
    expect(forward).not.toHaveBeenCalled();
  });

  it("400s a streaming request rather than hanging the client", async () => {
    const result = await relay({ authorization: AUTH, body: { ...body, stream: true } }, deps());
    expect(result.status).toBe(400);
    expect((result.body as { error: { message: string } }).error.message).toContain("streaming");
  });

  it("400s a body that is not a JSON object", async () => {
    for (const bad of [undefined, null, "text", 42, [1, 2]]) {
      expect((await relay({ authorization: AUTH, body: bad }, deps())).status, String(bad)).toBe(
        400,
      );
    }
  });

  it("passes an upstream failure through as-is", async () => {
    const result = await relay(
      { authorization: AUTH, body },
      deps({ forward: async () => ({ status: 400, body: { error: { message: "bad request" } } }) }),
    );
    expect(result.status).toBe(400);
    expect(result.passthrough).toBe(true);
  });

  it("returns an OpenAI-shaped error for every refusal", async () => {
    // The client is the OpenAI SDK; a body it cannot parse becomes a generic
    // failure instead of a message the user can act on.
    const cases = [
      await relay({ body }, deps()),
      await relay({ authorization: AUTH, body }, deps({ disabled: true })),
      await relay({ authorization: AUTH, body: "nope" }, deps()),
      await relay(
        { authorization: AUTH, body },
        deps({ checkQuota: async () => ({ allowed: false, used: 60, limit: 60 }) }),
      ),
    ];
    for (const result of cases) {
      expect(result.body).toMatchObject({ error: { message: expect.any(String) } });
    }
  });
});
