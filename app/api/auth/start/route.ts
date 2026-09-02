import { GOOGLE_CLIENT_ID } from "@/lib/server/googleClient";
import { buildAuthUrl, newPkce, savePending } from "@/lib/server/oauth";

/**
 * Begin a sign-in: mint PKCE, park it, and bounce to Google.
 *
 * The redirect URI is derived from *this* request rather than compiled in,
 * because the app's port is whatever was free at launch. Whatever it comes out
 * as is stored and resent at the token exchange verbatim — Google compares the
 * two byte for byte.
 */
export async function GET(request: Request) {
  if (!GOOGLE_CLIENT_ID) {
    return Response.json(
      { error: "this build has no Google OAuth client configured", code: "google_client_missing" },
      { status: 503 },
    );
  }

  const redirectUri = new URL("/api/auth/callback", request.url).toString();
  const { state, verifier, challenge } = newPkce();
  await savePending({ state, verifier, redirectUri, createdAt: Date.now() });

  return Response.redirect(
    buildAuthUrl({ clientId: GOOGLE_CLIENT_ID, redirectUri, state, challenge }),
    302,
  );
}
