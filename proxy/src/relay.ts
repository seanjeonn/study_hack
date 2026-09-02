import { BETA_TOKEN_PREFIX, TOKEN_PATTERN, type TokenRecord } from "./tokens";
import type { QuotaDecision } from "./quota";

/**
 * The relay's policy, as one function with its dependencies injected.
 *
 * Every decision that costs money or refuses a user lives here rather than in
 * the http plumbing, so the interesting cases — a revoked token, the kill
 * switch, the 60th request versus the 61st, an attempt to bill us for gpt-5 —
 * are unit tests instead of things you find out in production.
 */

/** The code the app maps to its "your free allowance is gone" message. */
export const QUOTA_EXHAUSTED_CODE = "beta_quota_exhausted";

/**
 * Every request is rewritten to this model, whatever the client asked for.
 *
 * Not a default — an override. The client is an app we ship, but the token is
 * in the user's hands, and `curl` with `"model": "gpt-5"` against a free beta
 * would be someone else's bill.
 */
export const PINNED_MODEL = "gpt-5-mini";

/** Largest request body we will read, before OpenAI ever sees it. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface RelayResult {
  status: number;
  body: unknown;
  /** Set when the response is OpenAI's own, passed through verbatim. */
  passthrough?: boolean;
}

export interface RelayDeps {
  /** The kill switch: relaying is off, telemetry is unaffected. */
  disabled: boolean;
  getToken: (token: string) => TokenRecord | undefined;
  checkQuota: (token: string, limit: number) => Promise<QuotaDecision>;
  forward: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
}

/** An OpenAI-shaped error, so the SDK on the other end parses it as one. */
export function errorBody(message: string, type: string, code?: string): unknown {
  return { error: { message, type, code: code ?? null, param: null } };
}

/**
 * Pull the bearer token out of an Authorization header.
 *
 * Only `sb-beta-…` shaped values are accepted. Anything else — an OpenAI key
 * most of all — is rejected without a lookup: a user who mispastes their real
 * `sk-` key into a field pointed at us should get a 401, not have it forwarded
 * anywhere.
 */
export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const value = match?.[1];
  if (!value || !value.startsWith(BETA_TOKEN_PREFIX) || !TOKEN_PATTERN.test(value)) {
    return undefined;
  }
  return value;
}

export async function relay(
  request: { authorization?: string; body: unknown },
  deps: RelayDeps,
): Promise<RelayResult> {
  const token = bearerToken(request.authorization);
  if (!token) {
    return {
      status: 401,
      body: errorBody("a study-hack beta token is required", "invalid_request_error"),
    };
  }

  // Order matters: the kill switch comes before the quota read, so turning the
  // relay off costs nothing and cannot be worn down by traffic.
  if (deps.disabled) {
    return {
      status: 503,
      body: errorBody("the beta relay is temporarily disabled", "service_unavailable"),
    };
  }

  const record = deps.getToken(token);
  if (!record) {
    return { status: 401, body: errorBody("unknown or revoked token", "invalid_request_error") };
  }

  if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) {
    return { status: 400, body: errorBody("expected a JSON object body", "invalid_request_error") };
  }
  const body = { ...(request.body as Record<string, unknown>) };

  // Streaming is out of scope for the beta, and silently ignoring the flag
  // would hang a client that is waiting for SSE frames that never come.
  if (body.stream === true) {
    return {
      status: 400,
      body: errorBody("streaming is not supported by the beta relay", "invalid_request_error"),
    };
  }

  const quota = await deps.checkQuota(token, record.monthlyLimit);
  if (!quota.allowed) {
    return {
      status: 429,
      body: errorBody(
        `the free beta allowance of ${quota.limit} requests for this month is used up`,
        "insufficient_quota",
        QUOTA_EXHAUSTED_CODE,
      ),
    };
  }

  body.model = PINNED_MODEL;
  const upstream = await deps.forward(body);
  return { status: upstream.status, body: upstream.body, passthrough: true };
}
