"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  ExtractionReportSchema,
  MemoSchema,
  PageTextResponseSchema,
  PdfStatusResponseSchema,
  PdfUploadResponseSchema,
  StudyLogResponseSchema,
  type ExtractionReport,
  type PageTextResponse,
  type PdfStatus,
  type PdfUploadResponse,
  type StudyLogItem,
} from "@study-hack/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STATUS_LABEL: Record<PdfStatus, string> = {
  uploaded: "Waiting to extract text…",
  processing: "Extracting text…",
  text_ready: "Text ready",
  failed: "Text extraction failed",
};

const RECOMMENDATION_LABEL: Record<ExtractionReport["recommendation"], string> = {
  ok: "Extraction quality looks good",
  consider_ocr: "Consider OCR (many pages have little or no text)",
  consider_llm_or_ocr: "Consider OCR/LLM (text may be garbled)",
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
  const [memoDraft, setMemoDraft] = useState("");
  const [memoSaving, setMemoSaving] = useState(false);
  const [studyLog, setStudyLog] = useState<StudyLogItem[]>([]);
  const [studyLogError, setStudyLogError] = useState<string | null>(null);

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

  // Once text is ready, load the study log (the PDF's memos).
  useEffect(() => {
    if (!doc || status !== "text_ready") return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}/study-log`);
        if (!res.ok) return;
        const parsed = StudyLogResponseSchema.parse(await res.json());
        if (active) setStudyLog(parsed.items);
      } catch {
        // leave studyLog empty; panel just won't show entries
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, status]);

  // Re-fetch the study log after a memo is added or deleted (user-triggered,
  // not tied to an effect, so no active-guard is needed here).
  async function refreshStudyLog() {
    if (!doc) return;
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/study-log`);
      if (!res.ok) return;
      const parsed = StudyLogResponseSchema.parse(await res.json());
      setStudyLog(parsed.items);
    } catch {
      // leave the previous study log in place
    }
  }

  async function submitMemo() {
    if (!doc || !memoDraft.trim() || memoSaving) return;
    setMemoSaving(true);
    setStudyLogError(null);
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: memoDraft.trim(), pageNumber: page }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `failed to save note (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      MemoSchema.parse(await res.json());
      setMemoDraft("");
      await refreshStudyLog();
    } catch (err) {
      setStudyLogError(err instanceof Error ? err.message : "failed to save note");
    } finally {
      setMemoSaving(false);
    }
  }

  async function deleteMemoItem(memoId: string) {
    if (!doc) return;
    setStudyLogError(null);
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/memos/${memoId}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `failed to delete note (${res.status})`);
      }
      await refreshStudyLog();
    } catch (err) {
      setStudyLogError(err instanceof Error ? err.message : "failed to delete note");
    }
  }

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
    setMemoDraft("");
    setMemoSaving(false);
    setStudyLog([]);
    setStudyLogError(null);
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

      {status === "text_ready" ? (
        <div className="flex flex-col gap-4 rounded-xl border border-[#e6e5e0] bg-white p-4">
          <div className="flex flex-col gap-2">
            <textarea
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              disabled={memoSaving}
              placeholder={`Add a note for page ${page}…`}
              rows={3}
              className="w-full resize-none rounded-md border border-[#cfcdc4] bg-white px-3 py-2 text-sm text-[#26251e] placeholder:text-[#a09c92] disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void submitMemo()}
              disabled={memoSaving || !memoDraft.trim()}
              className="w-fit rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {memoSaving ? "Saving…" : "Add note"}
            </button>
          </div>

          {studyLogError ? <p className="text-sm text-[#cf2d56]">{studyLogError}</p> : null}

          {studyLog.length > 0 ? (
            <div className="flex flex-col gap-3">
              {studyLog.map((item) => (
                <div
                  key={`memo-${item.id}`}
                  className="flex flex-col gap-2 rounded-xl border border-[#e6e5e0] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
                      Note{item.pageNumber !== null ? ` · p.${item.pageNumber}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => void deleteMemoItem(item.id)}
                      aria-label="Delete note"
                      className="text-sm text-[#807d72] transition-colors hover:text-[#cf2d56]"
                    >
                      ×
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-[#26251e]">{item.content}</p>
                  {item.pageNumber !== null ? (
                    <button
                      type="button"
                      onClick={() => go(item.pageNumber as number)}
                      className="w-fit rounded-full border border-[#cfcdc4] px-2.5 py-0.5 text-xs text-[#26251e] transition-colors hover:bg-[#efeee8]"
                    >
                      p.{item.pageNumber}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#807d72]">No notes yet.</p>
          )}
        </div>
      ) : null}

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
            Extracted text · page {page}
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
          Text coverage {Math.round(report.hasTextRatio * 100)}% ({report.textPages}/
          {report.pageCount}p)
        </span>
        <span>Avg {Math.round(report.avgCharsPerTextPage)} chars/page</span>
        <span>Garbled {Math.round(report.suspiciousRatio * 1000) / 10}%</span>
        {report.suspectPages > 0 ? <span>{report.suspectPages} suspect pages</span> : null}
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
        {status === "failed" ? "Text extraction failed." : "Extracting text…"}
      </p>
    );
  }
  if (!pageText) {
    return <p className="text-sm text-[#807d72]">Loading this page&apos;s text…</p>;
  }
  if (!pageText.hasText) {
    return (
      <p className="text-sm text-[#8a6418]">
        This page has little or no extractable text (scanned/image — OCR candidate).
      </p>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[#26251e]">
      {pageText.text}
    </pre>
  );
}
