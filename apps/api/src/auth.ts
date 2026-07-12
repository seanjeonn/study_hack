import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/client.js";
import { account, session, user, verification } from "./db/schema.js";

export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

/**
 * better-auth owns every /api/auth/* endpoint (email+password now, Google when
 * the client id/secret env vars are present). Session cookies are issued and
 * validated here; the rest of the API only consumes sessions via requireAuth.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: { enabled: true },
  ...(googleClientId && googleClientSecret
    ? {
        socialProviders: {
          google: { clientId: googleClientId, clientSecret: googleClientSecret },
        },
      }
    : {}),
  trustedOrigins: [WEB_ORIGIN],
});

/** Reject unauthenticated requests; expose the caller's user id to handlers. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionData = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!sessionData) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  res.locals.userId = sessionData.user.id;
  next();
}
