import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { SessionSchema, type Session } from "@/lib/schemas";
import { CONFIG_DIR } from "@/lib/server/config";
import { atomicWrite } from "@/lib/server/workspace";

/**
 * Who is signed in, kept next to the app's other settings in `~/.study-hack/`
 * rather than in the workspace — the workspace is the user's to sync, commit
 * and open in Obsidian, and an identity file has no business in there.
 *
 * **This gate is a product gate, not a security boundary.** The server listens
 * on loopback with no origin check, so any page in the user's browser can call
 * these APIs whether or not a session file exists. What it buys is a single
 * front door: every launch goes through Google once, which is what makes the
 * managed AI token issuable without a password and the beta cohort knowable.
 * It is not protecting the user's files from anything.
 */
export const SESSION_PATH = path.join(CONFIG_DIR, "session.json");

/**
 * The stored session, or null.
 *
 * Read fresh on every call, like `readConfig`: sign-in and sign-out write this
 * file mid-process, and a memoized copy is how "I signed in and it still says
 * signed out" happens.
 *
 * A hand-edited or half-written file reads as signed out rather than throwing.
 * The consequence of the fallback is one extra trip through Google, which is
 * strictly better than a 500 on every page.
 */
export async function readSession(): Promise<Session | null> {
  let raw: string;
  try {
    raw = await fs.readFile(SESSION_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[session] could not read ${SESSION_PATH}:`, err);
    }
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[session] ${SESSION_PATH} is not valid JSON — treating as signed out`);
    return null;
  }
  const result = SessionSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`[session] ${SESSION_PATH} did not validate — treating as signed out`);
    return null;
  }
  return result.data;
}

/** Persist a session. Validated on the way out, so a bad write cannot happen. */
export async function writeSession(session: Session): Promise<void> {
  const next = SessionSchema.parse(session);
  await atomicWrite(SESSION_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

/** Sign out. Already-signed-out is success, not an error. */
export async function clearSession(): Promise<void> {
  await fs.rm(SESSION_PATH, { force: true });
}

/**
 * The page gate: return the session, or send the browser to `/login`.
 *
 * `redirect()` throws, so this never returns null — the call site can use the
 * result directly. Every gated page is `force-dynamic` (set once in the root
 * layout); without that the redirect would run at build time and get baked into
 * a static page.
 */
export async function requireSession(): Promise<Session> {
  const session = await readSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * The API gate: a 401 to return, or null to carry on.
 *
 * A `Response` rather than a throw so a route reads as
 * `const denied = await denyIfSignedOut(); if (denied) return denied;` — one
 * line, no control flow to get wrong, and nothing to catch.
 */
export async function denyIfSignedOut(): Promise<Response | null> {
  if (await readSession()) return null;
  return Response.json({ error: "sign in first", code: "signed_out" }, { status: 401 });
}
