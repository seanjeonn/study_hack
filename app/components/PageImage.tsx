"use client";

import { useState } from "react";

/** The rendered page PNG. Rendering can fail (a corrupt page, a missing
 * binding), so the image reports its own error instead of leaving the reader
 * stuck on a permanent "Rendering…" placeholder. */
export default function PageImage({
  pdfId,
  filename,
  page,
}: {
  pdfId: string;
  filename: string;
  page: number;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="relative flex min-h-[70vh] items-center justify-center overflow-auto rounded-xl border border-[#e6e5e0] bg-white p-4 lg:min-h-0">
      {state === "loading" ? (
        <span className="absolute text-sm text-[#807d72]">Rendering page {page}…</span>
      ) : null}
      {state === "error" ? (
        <div className="absolute flex flex-col items-center gap-3">
          <p className="text-sm text-[#cf2d56]">Could not render page {page}.</p>
          <button
            type="button"
            onClick={() => {
              setState("loading");
              setAttempt((n) => n + 1);
            }}
            className="rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8]"
          >
            Retry
          </button>
        </div>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={`${page}-${attempt}`}
        src={`/api/pdfs/${pdfId}/pages/${page}${attempt > 0 ? `?retry=${attempt}` : ""}`}
        alt={`${filename} — page ${page}`}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        className="max-w-full lg:max-h-full"
        style={{ opacity: state === "loaded" ? 1 : 0 }}
      />
    </div>
  );
}
