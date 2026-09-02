import "server-only";

import { BETA_TOKEN_PREFIX } from "@/lib/apiKey";
import { readConfig, updateConfig } from "@/lib/server/config";
import { PROXY_BASE_URL, resetClient } from "@/lib/server/llm";

/**
 * Redeem a Google id_token for a managed beta token, and save it.
 *
 * This is the whole reason sign-in exists: it replaces the hand-issued
 * `sb-beta-` tokens with an identity the proxy can check for itself.
 *
 * Three rules, all of them load-bearing:
 *
 * 1. **It never blocks sign-in.** Five-second timeout, every failure swallowed.
 *    The proxy being down, unreachable, or not yet provisioned must not stop a
 *    user from reading their own PDFs — those need no key at all.
 * 2. **It never overwrites an `sk-` key.** A user who brought their own OpenAI
 *    key chose their billing; silently repointing them at our relay would be
 *    taking that decision away from them.
 * 3. **It is safe to repeat.** The proxy issues one token per Google account,
 *    so signing in again after an outage returns the same token rather than
 *    minting a second one.
 */
const EXCHANGE_TIMEOUT_MS = 5000;

/** `POST /auth/exchange` sits at the proxy root; `PROXY_BASE_URL` ends in `/v1`. */
export function exchangeUrl(baseUrl: string = PROXY_BASE_URL): string {
  return new URL("/auth/exchange", baseUrl).toString();
}

/**
 * Ask the proxy for this account's token. Returns it, or undefined on any
 * failure — the caller has nothing useful to do with the reason.
 */
export async function fetchBetaToken(
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const res = await fetchImpl(exchangeUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.warn(`[beta] the proxy refused the exchange (${res.status})`);
    return undefined;
  }
  const payload = (await res.json()) as { token?: unknown };
  const token = payload.token;
  if (typeof token !== "string" || !token.startsWith(BETA_TOKEN_PREFIX)) {
    console.warn("[beta] the proxy returned no usable token");
    return undefined;
  }
  return token;
}

/**
 * The whole redemption, swallowing every failure. Returns whether a token was
 * saved, which the caller uses only for a log line.
 */
export async function redeemBetaToken(
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (readConfig().apiKey?.startsWith("sk-")) return false;
  try {
    const token = await fetchBetaToken(idToken, fetchImpl);
    if (!token) return false;
    await updateConfig({ apiKey: token });
    // The OpenAI client is memoized per key+endpoint; without this the app
    // would keep using whatever it resolved before the token arrived.
    resetClient();
    return true;
  } catch (err) {
    console.warn("[beta] could not reach the proxy — signing in anyway:", err);
    return false;
  }
}
