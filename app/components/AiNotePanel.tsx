"use client";

import { useEffect, useState } from "react";
import AiErrorNotice, { readAiError, type AiError } from "@/app/components/AiErrorNotice";
import FakeDoorDialog from "@/app/components/FakeDoorDialog";
import {
  fakeDoorShown,
  markFakeDoorShown,
  recordAttempt,
  shouldShowFakeDoor,
} from "@/lib/aiAttempts";
import { AiNoteResponseSchema } from "@/lib/schemas";

/**
 * The AI's accumulated annotations for a page. Nothing here runs on its own:
 * the model is called only when the reader presses Generate.
 */
export default function AiNotePanel({ pdfId, page }: { pdfId: string; page: number }) {
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AiError | null>(null);
  const [askPrice, setAskPrice] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/pdfs/${pdfId}/pages/${page}/ai-note`);
        if (!res.ok) return;
        const parsed = AiNoteResponseSchema.parse(await res.json());
        if (active) {
          setContent(parsed.content);
          setError(null);
        }
      } catch {
        // leave empty; Generate still works
      }
    })();
    return () => {
      active = false;
    };
  }, [pdfId, page]);

  async function generate() {
    // Counted before the request goes out: a press that comes back 503 for a
    // missing key still means someone wanted this.
    if (shouldShowFakeDoor(recordAttempt(), fakeDoorShown())) {
      markFakeDoorShown();
      setAskPrice(true);
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/pdfs/${pdfId}/pages/${page}/ai-note`, { method: "POST" });
      if (!res.ok) {
        setError(await readAiError(res, `failed to generate (${res.status})`));
        return;
      }
      // Validate the inbound payload at the boundary before trusting it.
      const parsed = AiNoteResponseSchema.parse(await res.json());
      setContent(parsed.content);
    } catch (err) {
      setError({
        status: 0,
        message: err instanceof Error ? err.message : "failed to generate an AI note",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#e6e5e0] bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
          AI note · page {page}
        </span>
        <span className="font-mono text-[11px] text-[#a09c92]">
          ai/page-{String(page).padStart(3, "0")}.md
        </span>
      </div>

      <div className="max-h-[32vh] overflow-auto">
        {content.trim() ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[#26251e]">
            {content}
          </pre>
        ) : (
          <p className="text-sm text-[#807d72]">
            No AI notes for this page yet. Generate one when you want a second read.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={pending}
          className="w-fit rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Reading the page…" : "Generate"}
        </button>
        <AiErrorNotice error={error} />
      </div>

      {askPrice ? <FakeDoorDialog onClose={() => setAskPrice(false)} /> : null}
    </div>
  );
}
