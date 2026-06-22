"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  ExtractionReportSchema,
  PageTextResponseSchema,
  PdfStatusResponseSchema,
  PdfUploadResponseSchema,
  type ExtractionReport,
  type PageTextResponse,
  type PdfStatus,
  type PdfUploadResponse,
} from "@study-hack/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STATUS_LABEL: Record<PdfStatus, string> = {
  uploaded: "텍스트 추출 대기 중…",
  processing: "텍스트 추출 중…",
  text_ready: "텍스트 준비됨",
  failed: "텍스트 추출 실패",
};

const RECOMMENDATION_LABEL: Record<ExtractionReport["recommendation"], string> = {
  ok: "추출 품질 양호",
  consider_ocr: "OCR 고려 (텍스트가 거의 없는 페이지 많음)",
  consider_llm_or_ocr: "OCR/LLM 고려 (텍스트 깨짐 의심)",
};

export default function PdfStudio() {
  const [doc, setDoc] = useState<PdfUploadResponse | null>(null);
  const [status, setStatus] = useState<PdfStatus | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [pageText, setPageText] = useState<PageTextResponse | null>(null);
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll processing status until extraction reaches a terminal state.
  useEffect(() => {
    if (!doc || status === "text_ready" || status === "failed") return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}`);
        if (!res.ok) return;
        const parsed = PdfStatusResponseSchema.parse(await res.json());
        if (active) setStatus(parsed.status);
      } catch {
        // transient; next tick retries
      }
    };
    void tick();
    const interval = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [doc, status]);

  // Once text is ready, load the quality report (once per document).
  useEffect(() => {
    if (!doc || status !== "text_ready" || report) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}/extraction-report`);
        if (!res.ok) return;
        const parsed = ExtractionReportSchema.parse(await res.json());
        if (active) setReport(parsed);
      } catch {
        // leave report null; panel just won't show
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, status, report]);

  // Load the current page's extracted text whenever the page or readiness changes.
  useEffect(() => {
    if (!doc || status !== "text_ready") return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}/pages/${page}/text`);
        if (!res.ok) return;
        const parsed = PageTextResponseSchema.parse(await res.json());
        if (active) setPageText(parsed);
      } catch {
        // leave null
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, status, page]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${API_URL}/pdf`, { method: "POST", body });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `upload failed (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      const parsed = PdfUploadResponseSchema.parse(await res.json());
      setDoc(parsed);
      setStatus("uploaded");
      setReport(null);
      setPageText(null);
      setPage(1);
      setPageLoading(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function go(target: number) {
    if (!doc) return;
    const clamped = Math.min(Math.max(target, 1), doc.pageCount);
    if (clamped !== page) {
      setPage(clamped);
      setPageLoading(true);
    }
  }

  function reset() {
    setDoc(null);
    setStatus(null);
    setReport(null);
    setPageText(null);
    setPage(1);
    setError(null);
  }

  if (!doc) {
    return (
      <section className="flex flex-col items-center gap-5 rounded-xl border border-[#e6e5e0] bg-white px-8 py-14 text-center">
        <p className="text-sm text-[#5a5852]">Choose a PDF file to get started.</p>
        <label className="cursor-pointer rounded-md bg-[#f54e00] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d04200]">
          {uploading ? "Uploading…" : "Select PDF"}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={handleFile}
          />
        </label>
        {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <p className="truncate text-sm text-[#5a5852]" title={doc.filename}>
            {doc.filename}
          </p>
          {status ? <StatusBadge status={status} /> : null}
        </div>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 rounded-md border border-[#cfcdc4] px-3 py-1.5 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8]"
        >
          New PDF
        </button>
      </div>

      {report ? <ExtractionReportPanel report={report} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="relative flex min-h-[60vh] items-center justify-center overflow-auto rounded-xl border border-[#e6e5e0] bg-white p-4">
          {pageLoading ? (
            <span className="absolute text-sm text-[#807d72]">Rendering page {page}…</span>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={page}
            src={`${API_URL}/pdf/${doc.id}/pages/${page}`}
            alt={`${doc.filename} — page ${page}`}
            onLoad={() => setPageLoading(false)}
            className="max-w-full"
            style={{ opacity: pageLoading ? 0 : 1 }}
          />
        </div>

        <div className="flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-[#e6e5e0] bg-white">
          <div className="border-b border-[#efeee8] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
            추출 텍스트 · 페이지 {page}
          </div>
          <div className="flex-1 overflow-auto p-4">
            <PageTextPanel
              status={status}
              pageText={pageText?.pageNumber === page ? pageText : null}
            />
          </div>
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
          {page} / {doc.pageCount}
        </span>
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page >= doc.pageCount}
          className="rounded-md border border-[#cfcdc4] px-4 py-2 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: PdfStatus }) {
  const tone =
    status === "text_ready"
      ? "bg-[#e6f4ee] text-[#1f8a65]"
      : status === "failed"
        ? "bg-[#fbe6ec] text-[#cf2d56]"
        : "bg-[#efeee8] text-[#807d72]";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.88px] ${tone}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ExtractionReportPanel({ report }: { report: ExtractionReport }) {
  const tone =
    report.recommendation === "ok"
      ? "border-[#bfe3d3] bg-[#e6f4ee] text-[#1f8a65]"
      : "border-[#e7cfa0] bg-[#f7efe0] text-[#8a6418]";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#e6e5e0] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs text-[#5a5852]">
        <span>
          텍스트 커버리지 {Math.round(report.hasTextRatio * 100)}% ({report.textPages}/
          {report.pageCount}p)
        </span>
        <span>평균 {Math.round(report.avgCharsPerTextPage)}자/페이지</span>
        <span>깨짐 {Math.round(report.replacementRatio * 1000) / 10}%</span>
      </div>
      <span
        className={`w-fit rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.88px] ${tone}`}
      >
        {RECOMMENDATION_LABEL[report.recommendation]}
      </span>
    </div>
  );
}

function PageTextPanel({
  status,
  pageText,
}: {
  status: PdfStatus | null;
  pageText: PageTextResponse | null;
}) {
  if (status !== "text_ready") {
    return (
      <p className="text-sm text-[#807d72]">
        {status === "failed" ? "텍스트 추출에 실패했습니다." : "텍스트를 추출하는 중입니다…"}
      </p>
    );
  }
  if (!pageText) {
    return <p className="text-sm text-[#807d72]">이 페이지의 텍스트를 불러오는 중…</p>;
  }
  if (!pageText.hasText) {
    return (
      <p className="text-sm text-[#8a6418]">
        이 페이지에는 추출 가능한 텍스트가 거의 없습니다 (스캔/이미지 — OCR 후보).
      </p>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[#26251e]">
      {pageText.text}
    </pre>
  );
}
