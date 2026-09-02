import { FakeDoorAnswerSchema } from "@/lib/schemas";
import { readConfig } from "@/lib/server/config";
import { PROXY_BASE_URL } from "@/lib/server/llm";
import { denyIfSignedOut } from "@/lib/server/session";
import { betaTokenId } from "@/lib/server/telemetry";

/**
 * The pricing answer, relayed to the beta proxy.
 *
 * Two rules, both deliberate:
 *
 * 1. **This does not check the telemetry opt-in.** Answering the question is
 *    the consent — the dialog asks exactly one thing and this sends exactly
 *    that one thing. Gating it on a separate setting would mean measuring only
 *    the people who had already opted into something else.
 * 2. **It always answers 204.** The proxy being down, slow, or unreachable is
 *    our problem, not something to surface in a dialog the user is closing.
 */

const FORWARD_TIMEOUT_MS = 3000;

export async function POST(request: Request) {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const parsed = FakeDoorAnswerSchema.safeParse(body);
  if (!parsed.success) {
    // Nothing to forward, but still not the user's problem.
    return new Response(null, { status: 204 });
  }

  // A short digest, never the token: the results file is the one thing you
  // actually want to share with someone, and it must not carry a live key.
  const cohort = betaTokenId(readConfig().apiKey);

  try {
    await fetch(new URL("/t/fakedoor", PROXY_BASE_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...parsed.data, betaTokenId: cohort }),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch {
    // The proxy is unreachable. One data point lost; the dialog still closes.
  }
  return new Response(null, { status: 204 });
}
