"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "@/app/components/useLocale";
import { getInstallId } from "@/lib/aiAttempts";
import { t } from "@/lib/i18n";
import { type FakeDoorAnswer } from "@/lib/schemas";

/**
 * The pricing question — the one measurement this release exists to take.
 *
 * Three deliberate choices:
 *
 * - **Three options, not two.** A forced yes/no inflates yes: people who have
 *   not decided pick the agreeable answer. "Not sure" gives them somewhere
 *   honest to go.
 * - **All three buttons look the same.** No orange CTA here. The brand's
 *   primary colour on "Yes, I'd pay" would be measuring our own button design.
 * - **It never blocks the AI request.** The generation the user pressed for is
 *   already running behind this; closing it, ignoring it, or answering it
 *   changes nothing about their note.
 *
 * Closing it counts too: a dismissal is a real answer to "would you pay", and
 * dropping it would bias the sample toward people willing to click something.
 */
export default function FakeDoorDialog({ onClose }: { onClose: () => void }) {
  const strings = t(useLocale());
  const answered = useRef(false);
  const firstButton = useRef<HTMLButtonElement>(null);

  const answer = (value: FakeDoorAnswer["answer"]) => {
    // Escape and the backdrop both route through here; a click landing at the
    // same moment must not send two answers.
    if (answered.current) return;
    answered.current = true;
    void fetch("/api/feedback/fakedoor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: value, installId: getInstallId(), price: "KRW7900" }),
    }).catch(() => {
      // The route always answers 204 anyway; a network failure here costs a
      // data point, never the user's work.
    });
    onClose();
  };

  useEffect(() => {
    firstButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") answer("dismissed");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `answer` is stable for the dialog's lifetime; re-binding on every render
    // would drop the listener mid-keypress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#26251e]/25 px-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) answer("dismissed");
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fake-door-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-[#e6e5e0] bg-white p-6"
      >
        <h2 id="fake-door-title" className="text-xl font-normal tracking-tight text-[#26251e]">
          {strings.fakeDoorTitle}
        </h2>
        <p className="text-sm leading-relaxed text-[#5a5852]">{strings.fakeDoorBody}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(
            [
              ["yes", strings.fakeDoorYes],
              ["not_sure", strings.fakeDoorNotSure],
              ["no", strings.fakeDoorNo],
            ] as const
          ).map(([value, label], index) => (
            <button
              key={value}
              ref={index === 0 ? firstButton : undefined}
              type="button"
              onClick={() => answer(value)}
              className="flex-1 rounded-md border border-[#cfcdc4] px-4 py-2 text-sm font-medium text-[#26251e] transition-colors hover:bg-[#efeee8]"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
