import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { classifyKey } from "@/lib/apiKey";
import { readConfig, updateConfig } from "@/lib/server/config";
import { PROXY_BASE_URL } from "@/lib/server/llm";

/**
 * Opt-in usage counts, sent to the beta proxy.
 *
 * Off unless the user turned it on in settings, and there is no code path that
 * turns it on for them. When it is off this module makes no network call, mints
 * no id, and writes nothing — `readConfig().telemetryOptIn` is the first line
 * of every function here.
 *
 * What goes out is counts: how many PDFs, how many notes, which event. Never a
 * note, a filename, a PDF, or a key.
 */

export type TelemetryEvent = "install" | "session" | "aiUse";

/** Both collection endpoints sit at the proxy root, beside its `/v1` relay. */
export const TELEMETRY_URL = new URL("/t/event", PROXY_BASE_URL).toString();

/** Telemetry must never delay a response, so the send is capped hard. */
const TIMEOUT_MS = 3000;

/** `session` is once per process, so a soft navigation does not re-send it. */
let sessionSent = false;

/**
 * `install` is once ever, latched in the config — but the config write is
 * async, and the sidebar fires several `/api/pdfs` requests at once on launch.
 * All of them would read `installEventSent: false` before any write landed and
 * every one would send, inflating the install count. This flag closes that
 * window synchronously; the config latch is what survives a restart.
 */
let installAttempted = false;

/**
 * Minting the install id is a read-then-write too, and two events firing at
 * once would each mint one and each write it — leaving events tagged with an
 * id that is no longer in the config. One shared promise means the first
 * caller mints and the rest wait for it.
 */
let installIdPromise: Promise<string> | undefined;

async function ensureInstallId(existing: string | undefined): Promise<string> {
  if (existing) return existing;
  installIdPromise ??= (async () => {
    // Re-read: another process may have written one since our snapshot.
    const fresh = readConfig().installId;
    if (fresh) return fresh;
    const minted = randomUUID();
    await updateConfig({ installId: minted });
    return minted;
  })();
  return installIdPromise;
}

/**
 * A stable, non-reversible marker for the beta token, when one is set.
 *
 * The token itself is a live credential and never leaves the machine. A short
 * digest still lets the operator match an event to a cohort — hash the rows in
 * tokens.json and compare — without the results file becoming a key store.
 */
export function betaTokenId(apiKey: string | undefined): string | undefined {
  if (!apiKey || classifyKey(apiKey) !== "beta") return undefined;
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
}

async function post(payload: Record<string, unknown>): Promise<void> {
  await fetch(TELEMETRY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Send one event. Fire-and-forget by design — callers must not await it, and
 * nothing it does can fail a request.
 */
export function sendEvent(event: TelemetryEvent, counts: Record<string, number> = {}): void {
  void (async () => {
    const config = readConfig();
    if (!config.telemetryOptIn) return;

    // The id is minted on first send, not on first launch: a user who never
    // opts in never gets one written to their config.
    const installId = await ensureInstallId(config.installId);

    await post({
      installId,
      event,
      version: process.env.npm_package_version,
      platform: process.platform,
      betaTokenId: betaTokenId(config.apiKey),
      ...counts,
    });
  })().catch(() => {
    // A telemetry failure is not an application error. Silent on purpose:
    // logging it on every request would be noise the user did not ask for.
  });
}

/**
 * The "app is open" signal: `install` once ever, `session` once per process.
 *
 * Called from `GET /api/pdfs`, which the sidebar fetches on mount and on every
 * navigation — and which, unlike the library page, is never prerendered.
 * Latched twice over: a module flag for the process, and `installEventSent` in
 * the config for the lifetime of the install.
 */
export function sendSessionEvent(counts: Record<string, number> = {}): void {
  const config = readConfig();
  if (!config.telemetryOptIn) return;

  if (!config.installEventSent && !installAttempted) {
    // Latch first, then send. A failed send loses one event; a failed latch
    // would re-send `install` on every launch and inflate the install count.
    installAttempted = true;
    void updateConfig({ installEventSent: true })
      .then(() => sendEvent("install", counts))
      .catch(() => undefined);
  }
  if (!sessionSent) {
    sessionSent = true;
    sendEvent("session", counts);
  }
}

/** Test seam: the process-level `session` and `install` latches. */
export function resetSessionLatch(): void {
  sessionSent = false;
  installAttempted = false;
  installIdPromise = undefined;
}
