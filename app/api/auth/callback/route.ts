import { redeemBetaToken } from "@/lib/server/betaToken";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from "@/lib/server/googleClient";
import { consumePending, decodeIdToken, exchangeCode } from "@/lib/server/oauth";
import { writeSession } from "@/lib/server/session";

/**
 * Where Google sends the browser back.
 *
 * This runs in whatever browser the consent screen opened in, which may not be
 * the one the app is in — so it ends at a plain page telling the user to go
 * back, and never at a redirect into the app. The app tab notices on its own:
 * the login page is polling `/api/auth/session`.
 */

function page(title: string, body: string, status = 200): Response {
  // Deliberately a hand-written document rather than a route into the app: this
  // tab is a detour, and rendering the shell here would invite the user to keep
  // working in the wrong window.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>study_hack</title>
    <style>
      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
             background: #f7f7f4; color: #26251e;
             font-family: system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif; }
      main { max-width: 26rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.375rem; font-weight: 400; letter-spacing: -0.11px; margin: 0 0 0.5rem; }
      p { font-size: 0.875rem; line-height: 1.5; color: #5a5852; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${body}</p>
    </main>
  </body>
</html>
`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const error = params.get("error");
  if (error) {
    return page("Sign-in was cancelled", "Nothing was saved. You can close this tab.", 400);
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return page("That link is incomplete", "Close this tab and start the sign-in again.", 400);
  }

  // Single slot, single use: an expired, replayed, or mismatched state finds
  // nothing to redeem.
  const pending = await consumePending(state);
  if (!pending) {
    return page("That sign-in expired", "Close this tab and start the sign-in again.", 400);
  }

  let idToken: string;
  try {
    idToken = await exchangeCode({
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
    });
  } catch (err) {
    console.error("[auth] the code exchange failed:", err);
    return page("Google would not complete the sign-in", "Close this tab and try again.", 502);
  }

  let claims;
  try {
    claims = decodeIdToken(idToken);
  } catch (err) {
    console.error("[auth] the id_token could not be read:", err);
    return page("Google would not complete the sign-in", "Close this tab and try again.", 502);
  }

  try {
    await writeSession({
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      signedInAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[auth] could not write the session:", err);
    return page("Could not save the sign-in", "Check that ~/.study-hack is writable.", 500);
  }

  // Deliberately last, and deliberately unable to fail the sign-in: the managed
  // AI token is a bonus on top of an app that reads PDFs without any key.
  const connected = await redeemBetaToken(idToken);
  console.info(`[auth] signed in as ${claims.email}${connected ? " · AI connected" : ""}`);

  return page("You're signed in", "Go back to the study_hack tab — it will move on by itself.");
}
