import { z } from "zod";

/**
 * Checking a Google id_token that arrived from an untrusted client.
 *
 * The app decodes the same token without verifying it, and that is fine there:
 * it got the token over TLS from Google's own endpoint. Here it arrives in a
 * POST body from a program on someone's laptop, so the signature is the only
 * thing standing between a forged `sub` and a free token.
 *
 * Verification is one call to Google's `tokeninfo` endpoint rather than a JWKS
 * fetch, a key cache, a rotation policy and a JWT library. This proxy issues a
 * handful of tokens a week; one round trip on the sign-in path is cheaper than
 * all of that, and Google is the one checking the signature either way. The
 * *claims* — which are the interesting part, and the part with a policy in it —
 * are checked here, in a pure function with tests.
 */

export const TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

/**
 * What tokeninfo returns. Numeric claims come back as decimal *strings*, which
 * is the documented shape and the reason `exp` is coerced rather than typed as
 * a number.
 */
export const TokenInfoSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().min(1),
  email: z.string().min(1),
  /** Also a string ("true"), not a boolean. */
  email_verified: z.union([z.boolean(), z.string()]),
  exp: z.coerce.number(),
});

/** The issuers Google signs id_tokens with. Both are current; neither is legacy. */
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/**
 * Ask Google what this token says. `fetchImpl` is injected so the callers'
 * tests never touch the network.
 *
 * Returns the raw payload — validating it is `verifyClaims`'s job, so an
 * unexpected shape lands in one place with one policy.
 */
export async function fetchTokenInfo(
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const url = `${TOKENINFO_ENDPOINT}?id_token=${encodeURIComponent(idToken)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return undefined;
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export interface ClaimsPolicy {
  /** The one client id we issued the app with. A token minted for anyone else is not ours. */
  clientId: string;
  /** Lowercased. Empty means "no allowlist configured", which refuses everyone. */
  allowedEmails: string[];
  maxAccounts: number;
  /** How many accounts already exist, and whether this one is one of them. */
  accountCount: number;
  isKnownAccount: boolean;
  /** Epoch seconds. Injected so expiry is a test, not a wait. */
  now: number;
}

export type ClaimsResult =
  | { ok: true; sub: string; email: string }
  | { ok: false; status: number; message: string };

/**
 * The whole issuing policy, as one pure function.
 *
 * 401 means "this token is not a valid identity" — forged, expired, or minted
 * for a different application. 403 means "we believe you, and the answer is
 * still no" — outside the beta cohort, or the cohort is full. Keeping those
 * apart matters: a 401 is worth retrying after signing in again, and a 403
 * never is.
 *
 * An already-known account is never refused by the cap. The cap exists to stop
 * the beta growing past what one prepaid OpenAI key can carry, and turning
 * away someone who is already inside it does not save any money — it just
 * breaks their app the next time the proxy hiccups and they sign in again.
 */
export function verifyClaims(payload: unknown, policy: ClaimsPolicy): ClaimsResult {
  const parsed = TokenInfoSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, status: 401, message: "that is not a Google id token" };
  }
  const claims = parsed.data;

  if (!GOOGLE_ISSUERS.includes(claims.iss)) {
    return { ok: false, status: 401, message: "unexpected issuer" };
  }
  if (claims.aud !== policy.clientId) {
    return { ok: false, status: 401, message: "that token was issued for another application" };
  }
  if (claims.exp <= policy.now) {
    return { ok: false, status: 401, message: "that token has expired" };
  }
  // A Google account can carry an unverified email address; issuing on one
  // would let anyone claim any address by putting it on a fresh account.
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    return { ok: false, status: 403, message: "that Google account has no verified email" };
  }

  const email = claims.email.toLowerCase();
  if (!policy.allowedEmails.includes(email)) {
    return { ok: false, status: 403, message: "that account is not in the beta" };
  }
  if (!policy.isKnownAccount && policy.accountCount >= policy.maxAccounts) {
    return { ok: false, status: 403, message: "the beta is full" };
  }

  return { ok: true, sub: claims.sub, email };
}

/** Parse the `ALLOWED_EMAILS` env var: comma separated, trimmed, lowercased. */
export function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}
