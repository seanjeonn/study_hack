"use client";

import Link from "next/link";
import { useLocale } from "@/app/components/useLocale";
import { t } from "@/lib/i18n";

/**
 * A failed AI request, kept as a status rather than a string.
 *
 * The status is the whole point: both AI buttons used to throw away
 * `res.status` and render whatever prose the server sent, which meant "no key
 * configured" — by far the most common failure, and the only one with an
 * obvious fix — read like a crash instead of a next step.
 */
export interface AiError {
  status: number;
  code?: string;
  message: string;
}

/** Build an `AiError` from a failed response. Never throws. */
export async function readAiError(res: Response, fallback: string): Promise<AiError> {
  const payload = (await res.json().catch(() => null)) as {
    error?: string;
    code?: string;
  } | null;
  return { status: res.status, code: payload?.code, message: payload?.error ?? fallback };
}

/**
 * Renders one failed AI request.
 *
 * A 503 means no usable key, and since sign-in there are two ways to get one:
 * the managed token that arrives with a Google account (which is missing when
 * the proxy was unreachable at sign-in, or the account is outside the beta
 * allowlist), or a key of the user's own. Both routes are offered, because the
 * app cannot tell from here which one this user is on.
 *
 * These two links are the app's entire onboarding, which is why there is no
 * setup modal: the first dialog a user sees should be the pricing question,
 * not a wizard.
 */
export default function AiErrorNotice({ error }: { error: AiError | null }) {
  const strings = t(useLocale());
  if (!error) return null;

  if (error.status === 503) {
    return (
      <p className="text-sm text-[#cf2d56]">
        {strings.aiNotConnected}{" "}
        {/* A full load, not a router push: signing in again replaces the
            session the layout was rendered from. */}
        <a href="/login" className="underline underline-offset-2 hover:text-[#26251e]">
          {strings.signInButton}
        </a>
        {" · "}
        <Link href="/settings" className="underline underline-offset-2 hover:text-[#26251e]">
          {strings.noKeyAction}
        </Link>
      </p>
    );
  }
  if (error.status === 429) {
    return <p className="text-sm text-[#cf2d56]">{strings.quotaExhausted}</p>;
  }
  return <p className="text-sm text-[#cf2d56]">{error.message}</p>;
}
