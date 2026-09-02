"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/app/components/useLocale";
import { t } from "@/lib/i18n";
import { SessionResponseSchema } from "@/lib/schemas";

/**
 * The one thing behind which the whole app sits.
 *
 * The button is an `<a target="_blank">`, not a fetch: Google refuses to render
 * its consent screen inside an embedded webview, so the sign-in has to leave
 * for a real browser tab. That tab never comes back here — it ends on a "you
 * can close this" page — so this one polls `/api/auth/session` and moves itself
 * along the moment the session file appears.
 *
 * `location.href` rather than a router push, because the layout has to
 * re-render with a sidebar it did not have a second ago.
 */
export default function SignInPanel({ configured }: { configured: boolean }) {
  const [started, setStarted] = useState(false);
  const strings = t(useLocale());

  useEffect(() => {
    if (!started) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        // Validate the inbound payload at the boundary before trusting it.
        const parsed = SessionResponseSchema.parse(await res.json());
        if (active && parsed.signedIn) window.location.href = "/";
      } catch {
        // The next tick tries again; a blip is not worth surfacing.
      }
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [started]);

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-[#e6e5e0] bg-white p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[22px] font-normal leading-[1.3] tracking-[-0.11px]">
          {strings.signInTitle}
        </h1>
        <p className="text-sm leading-[1.5] text-[#5a5852]">{strings.signInBody}</p>
      </header>

      {configured ? (
        <div className="flex flex-col gap-3">
          <a
            href="/api/auth/start"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setStarted(true)}
            className="inline-flex h-10 items-center justify-center rounded-md bg-[#f54e00] px-[18px] text-sm font-medium text-white transition-colors hover:bg-[#d04200]"
          >
            {strings.signInButton}
          </a>
          {started ? <p className="text-sm text-[#807d72]">{strings.signInWaiting}</p> : null}
        </div>
      ) : (
        <p className="rounded-md border border-[#e6e5e0] bg-[#f7f7f4] px-4 py-3 text-sm leading-[1.5] text-[#cf2d56]">
          {strings.signInUnavailable}
        </p>
      )}
    </div>
  );
}
