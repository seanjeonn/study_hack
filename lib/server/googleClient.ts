import "server-only";

/**
 * The Google OAuth client this app signs in with.
 *
 * Compiled in rather than configured, for the same reason `PROXY_BASE_URL` is
 * (`lib/server/llm.ts`): a client id is only meaningful against our own consent
 * screen, so pairing them at build time means one less thing a user can get
 * wrong. `STUDY_GOOGLE_CLIENT_ID` / `STUDY_GOOGLE_CLIENT_SECRET` override both
 * for dogfooding against a throwaway client.
 *
 * The client is of type "Desktop app", whose secret Google's own documentation
 * calls not-a-secret: it ships inside the installed binary, PKCE is what
 * actually protects the exchange, and the client is restricted to loopback
 * redirects. Shipping it is the documented arrangement, not a leak.
 *
 * TODO(setup): both are empty until the OAuth client exists in Google Cloud.
 * `/api/auth/start` answers 503 `google_client_missing` until then — the honest
 * failure, rather than bouncing users to a consent screen that cannot load.
 */
export const GOOGLE_CLIENT_ID = process.env.STUDY_GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.STUDY_GOOGLE_CLIENT_SECRET ?? "";

/** Whether sign-in can even be attempted. */
export function isGoogleClientConfigured(): boolean {
  return GOOGLE_CLIENT_ID !== "";
}
