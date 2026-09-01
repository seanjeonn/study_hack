/**
 * How many times this browser has pressed an AI button, and whether the
 * pricing question has been asked yet. Kept in localStorage — a browser
 * convenience, not workspace data, so nothing here touches a file or an API.
 * Safe to import from client components: no node-only code.
 *
 * Attempts are counted *before* the request goes out, so a press that comes
 * back as a 503 for a missing key still counts. That is the whole point: the
 * people worth asking about price include the ones who wanted the feature and
 * could not have it.
 *
 * Every function swallows storage failures. A browser with storage disabled
 * loses the counter, which costs a measurement — throwing would cost the user
 * their AI note.
 */
const ATTEMPTS_KEY = "study_hack:ai-attempts";
const SHOWN_KEY = "study_hack:fake-door-shown";
const INSTALL_ID_KEY = "study_hack:install-id";

/** Presses before the pricing question is asked. */
export const FAKE_DOOR_THRESHOLD = 3;

export function parseCount(raw: string | null): number {
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : 0;
}

/**
 * Ask exactly once, and only after the feature has been wanted repeatedly.
 *
 * Three is the point at which "I clicked the thing" has become "I keep
 * clicking the thing" — asking on the first press measures curiosity, and
 * asking every time measures annoyance.
 */
export function shouldShowFakeDoor(attempts: number, alreadyShown: boolean): boolean {
  return !alreadyShown && attempts >= FAKE_DOOR_THRESHOLD;
}

export function readAttempts(): number {
  try {
    return parseCount(window.localStorage.getItem(ATTEMPTS_KEY));
  } catch {
    return 0;
  }
}

/** Count one press and return the new total. */
export function recordAttempt(): number {
  const next = readAttempts() + 1;
  try {
    window.localStorage.setItem(ATTEMPTS_KEY, String(next));
  } catch {
    // Ignore: the counter is a measurement, never a requirement.
  }
  return next;
}

export function fakeDoorShown(): boolean {
  try {
    return window.localStorage.getItem(SHOWN_KEY) === "1";
  } catch {
    // Unreadable storage means we cannot tell — assume shown, so a user with
    // storage disabled is asked at most once per page load rather than on
    // every single press.
    return true;
  }
}

export function markFakeDoorShown(): void {
  try {
    window.localStorage.setItem(SHOWN_KEY, "1");
  } catch {
    // Ignore.
  }
}

/**
 * A random id for this browser, minted on first use.
 *
 * Not tied to any identity and never sent anywhere unless the user answers the
 * pricing question or turns telemetry on. It exists so two answers from one
 * person are not counted as two people.
 */
export function getInstallId(): string {
  try {
    const existing = window.localStorage.getItem(INSTALL_ID_KEY);
    if (existing) return existing;
    const minted = window.crypto.randomUUID();
    window.localStorage.setItem(INSTALL_ID_KEY, minted);
    return minted;
  } catch {
    // No storage: a per-page-load id still deduplicates a double click.
    return "anonymous";
  }
}
