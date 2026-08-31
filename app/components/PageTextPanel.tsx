"use client";

import { useEffect, useState } from "react";
import { PageTextResponseSchema, type PageTextResponse } from "@/lib/schemas";

/** The page's extracted text — the same text the AI features are grounded in. */
export default function PageTextPanel({ pdfId, page }: { pdfId: string; page: number }) {
  const [pageText, setPageText] = useState<PageTextResponse | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/pdfs/${pdfId}/pages/${page}/text`);
        if (!res.ok) return;
        const parsed = PageTextResponseSchema.parse(await res.json());
        if (active) setPageText(parsed);
      } catch {
        // leave null; the panel shows its loading copy
      }
    })();
    return () => {
      active = false;
    };
  }, [pdfId, page]);

  const current = pageText?.pageNumber === page ? pageText : null;

  return (
    <div className="flex max-h-[40vh] flex-col overflow-hidden rounded-xl border border-[#e6e5e0] bg-white">
      <div className="border-b border-[#efeee8] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
        Extracted text · page {page}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {!current ? (
          <p className="text-sm text-[#807d72]">Loading this page&apos;s text…</p>
        ) : !current.hasText ? (
          <p className="text-sm text-[#8a6418]">
            This page has little or no extractable text (scanned/image — OCR candidate).
          </p>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[#26251e]">
            {current.text}
          </pre>
        )}
      </div>
    </div>
  );
}
