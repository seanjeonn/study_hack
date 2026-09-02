import "server-only";

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PendingAuthSchema, type PendingAuth } from "@/lib/schemas";
import { CONFIG_DIR } from "@/lib/server/config";
import { atomicWrite } from "@/lib/server/workspace";

/**
 * The Google half of sign-in: PKCE, the authorize URL, the one pending slot,
 * and the code exchange.
 *
 * All of it is here rather than in the route handlers so the interesting cases
 * — a replayed state, an expired one, a redirect URI that drifted between the
 * two legs — are unit tests instead of things you find out in front of a user.
 */

export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Where the one in-flight sign-in is parked. */
export const PENDING_AUTH_PATH = path.join(CONFIG_DIR, "pending-auth.json");

/**
 * How long a started sign-in stays redeemable.
 *
 * Long enough to read a consent screen and pick an account, short enough that
 * an abandoned attempt left on disk is not a standing invitation.
 */
export const PENDING_TTL_MS = 10 * 60 * 1000;

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export interface Pkce {
  state: string;
  verifier: string;
  challenge: string;
}

/**
 * A fresh PKCE pair and the state that ties the two legs together.
 *
 * 32 random bytes each, base64url — the verifier lands at 43 characters, inside
 * RFC 7636's 43..128, and the challenge is its S256 digest.
 */
export function newPkce(): Pkce {
  const verifier = base64url(randomBytes(32));
  return {
    state: base64url(randomBytes(32)),
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
  };
}

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}

/**
 * The Google consent URL.
 *
 * `openid email profile` and nothing else: those three scopes need no
 * verification review, which is what lets the consent screen be published
 * rather than left in Testing (where a tester list has to be maintained by hand
 * and tokens expire after seven days).
 *
 * `prompt=select_account` because the realistic user has two Google accounts
 * and a silent pick of the wrong one is a confusing thing to undo.
 */
export function buildAuthUrl({ clientId, redirectUri, state, challenge }: AuthUrlParams): string {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

/** Park the in-flight sign-in, replacing whatever was there. */
export async function savePending(pending: PendingAuth): Promise<void> {
  const next = PendingAuthSchema.parse(pending);
  await atomicWrite(PENDING_AUTH_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Take the pending sign-in back, if `state` matches and it has not expired.
 *
 * The file is deleted whatever the outcome, which is what makes an
 * authorization code single-use from this side too: a replayed callback finds
 * nothing to redeem. A corrupt file reads as "nothing pending" rather than
 * throwing — the user retries and gets a fresh slot.
 */
export async function consumePending(
  state: string,
  now: number = Date.now(),
): Promise<PendingAuth | null> {
  let raw: string;
  try {
    raw = await fs.readFile(PENDING_AUTH_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[oauth] could not read ${PENDING_AUTH_PATH}:`, err);
    }
    return null;
  }
  await fs.rm(PENDING_AUTH_PATH, { force: true });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[oauth] ${PENDING_AUTH_PATH} is not valid JSON — start again`);
    return null;
  }
  const result = PendingAuthSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`[oauth] ${PENDING_AUTH_PATH} did not validate — start again`);
    return null;
  }
  if (result.data.state !== state) return null;
  if (now - result.data.createdAt > PENDING_TTL_MS) return null;
  return result.data;
}

export interface ExchangeParams {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Trade the authorization code for an id_token.
 *
 * `fetchImpl` is injected so the failure paths — a 400 from Google, a body with
 * no id_token in it — are testable without a network.
 */
export async function exchangeCode(
  { code, verifier, redirectUri, clientId, clientSecret }: ExchangeParams,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`google token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("google token endpoint returned a non-JSON response");
  }
  const idToken = (payload as { id_token?: unknown }).id_token;
  if (typeof idToken !== "string" || idToken === "") {
    throw new Error("google token response carried no id_token");
  }
  return idToken;
}

/** The identity claims this app reads out of an id_token. */
export interface IdTokenClaims {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Read the claims out of an id_token **without verifying its signature**.
 *
 * That is safe here and only here: this token came back over TLS from Google's
 * own token endpoint in direct response to our request, so the transport has
 * already established who sent it. The proxy, which receives the same token
 * from an untrusted client, does not get to make that assumption — it checks
 * with Google (`proxy/src/googleToken.ts`).
 */
export function decodeIdToken(idToken: string): IdTokenClaims {
  const segment = idToken.split(".")[1];
  if (!segment) throw new Error("id_token is not a JWT");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new Error("id_token payload is not JSON");
  }
  const claims = payload as Record<string, unknown>;
  const sub = claims.sub;
  const email = claims.email;
  if (typeof sub !== "string" || sub === "") throw new Error("id_token carries no sub");
  if (typeof email !== "string" || email === "") throw new Error("id_token carries no email");
  return {
    sub,
    email,
    name: typeof claims.name === "string" ? claims.name : undefined,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
  };
}
