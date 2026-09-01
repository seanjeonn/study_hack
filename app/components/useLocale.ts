"use client";

import { useSyncExternalStore } from "react";
import { readLocale, type Locale } from "@/lib/i18n";

function subscribe(onChange: () => void): () => void {
  // Another tab (or a devtools edit) changing the stored locale should move
  // this one too. `storage` only fires for *other* documents, which is exactly
  // the case a re-render is needed for.
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * The active locale, read from the browser.
 *
 * `useSyncExternalStore` rather than an effect: localStorage and
 * `navigator.language` do not exist while the server renders, so the server
 * snapshot is English and the client swaps to the real locale during
 * hydration. Doing it with `useEffect(() => setLocale(...))` is the same thing
 * with an extra render and a lint error.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, readLocale, () => "en" as Locale);
}
