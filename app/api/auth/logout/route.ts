import { clearSession } from "@/lib/server/session";

/**
 * Sign out: delete the session file. The saved API key is deliberately left
 * alone — it is the user's setting, and signing back in would only hand the
 * same token back.
 */
export async function POST() {
  await clearSession();
  return Response.json({ signedIn: false });
}
