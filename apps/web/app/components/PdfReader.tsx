"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import AiNotePanel from "@/app/components/AiNotePanel";
import ExtractionReportPanel from "@/app/components/ExtractionReportPanel";
import PageNoteEditor from "@/app/components/PageNoteEditor";
import PageImage from "@/app/components/PageImage";
import PageTextPanel from "@/app/components/PageTextPanel";
import type { ExtractionReport, PdfSummary } from "@/lib/schemas";

export default function PdfReader({
  summary,
  extraction,
}: {
  summary: PdfSummary;
  extraction: ExtractionReport;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [reportOpen, setReportOpen] = useState(false);

  // The current page lives in the URL so a page is linkable — the concept map
  // deep-links straight to `?page=N`.
  const requested = Number(searchParams.get("page"));
  const page = clamp(Number.isInteger(requested) ? requested : 1, summary.pageCount);

  function go(target: number) {
    const clamped = clamp(target, summary.pageCount);
    if (clamped === page) return;
    // replace, not push: paging through a document should not bury the
    // library behind a long back-button history.
    router.replace(`/pdfs/${summary.id}?page=${clamped}`, { scroll: false });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setReportOpen((open) => !open)}
          className="w-fit text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72] transition-colors hover:text-[#26251e]"
        >
          {reportOpen ? "Hide" : "Show"} extraction quality
        </button>
        {reportOpen ? <ExtractionReportPanel report={extraction} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <PageImage pdfId={summary.id} filename={summary.filename} page={page} />

        <div className="flex flex-col gap-4">
          <PageNoteEditor pdfId={summary.id} page={page} />
          <AiNotePanel pdfId={summary.id} page={page} />
          <PageTextPanel pdfId={summary.id} page={page} />
        </div>
      </div>

      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <span className="font-mono text-sm tabular-nums text-[#5a5852]">
          {page} / {summary.pageCount}
        </span>
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page >= summary.pageCount}
          className="rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </section>
  );
}

function clamp(target: number, pageCount: number): number {
  if (!Number.isFinite(target)) return 1;
  return Math.min(Math.max(Math.trunc(target), 1), pageCount);
}
