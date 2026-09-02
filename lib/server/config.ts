import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppConfigSchema, type AppConfig } from "@/lib/schemas";
import { atomicWrite } from "@/lib/server/workspace";

/**
 * The app's own settings live in `~/.study-hack/`, never in the workspace.
 *
 * The workspace is the user's: they sync it, commit it, open it in Obsidian.
 * An API key must not be in there. It also keeps the "the app owns `.cache/`
 * only" rule intact — this directory belongs to the app outright.
 *
 * `STUDY_CONFIG_DIR` exists so tests never touch the real one.
 */
export const CONFIG_DIR = path.resolve(
  process.env.STUDY_CONFIG_DIR ?? path.join(os.homedir(), ".study-hack"),
);
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULTS: AppConfig = { telemetryOptIn: false, installEventSent: false };

/**
 * Read the config fresh from disk on every call.
 *
 * Not memoized on purpose: the settings form writes this file mid-process, and
 * a cached copy is exactly how "I saved my key and it still says no key" bugs
 * happen. It is a sub-kilobyte local file read at most once per request.
 *
 * Synchronous because `getClient()` is, and making it async would turn a
 * one-line key lookup into an await that ripples through every LLM call site.
 *
 * A hand-edited or half-written file falls back to defaults rather than
 * throwing — a broken config must never take the app down with it.
 */
export function readConfig(): AppConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[config] could not read ${CONFIG_PATH}:`, err);
    }
    return { ...DEFAULTS };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[config] ${CONFIG_PATH} is not valid JSON — using defaults`);
    return { ...DEFAULTS };
  }
  const result = AppConfigSchema.safeParse(parsed);
  if (!result.success) {
    console.warn(`[config] ${CONFIG_PATH} did not validate — using defaults`);
    return { ...DEFAULTS };
  }
  return result.data;
}

/**
 * Writes are chained through one promise.
 *
 * `updateConfig` is a read-modify-write, so two concurrent callers — the
 * telemetry module latching `installEventSent` while another send mints an
 * `installId`, say — would both read the same file and the second would
 * clobber the first's field. One process, one chain.
 */
let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Merge a patch into the config and write it atomically.
 *
 * Fields left out of the patch keep their stored value; an `apiKey` of `""`
 * removes the key rather than storing an empty one. Written through
 * `atomicWrite` so a reader — or an editor watching the directory — never sees
 * a half-written file.
 *
 * Callers that change the key must also `resetClient()`; this module
 * deliberately does not import `llm.ts` (that would be a cycle), and the
 * client's cache is keyed on the key anyway.
 */
export function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const run = writeChain.then(async () => {
    // Read inside the chain, so the merge sees the previous write.
    const merged: AppConfig = { ...readConfig() };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      Reflect.set(merged, key, value);
    }
    if (merged.apiKey === "") delete merged.apiKey;

    // Validate what we are about to persist, not just what came in: the merge
    // could have combined a valid patch with a stale field.
    const next = AppConfigSchema.parse(merged);
    await atomicWrite(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
  // Keep the chain alive even if this link rejects, or one failed write would
  // wedge every later one behind it.
  writeChain = run.catch(() => undefined);
  return run;
}
