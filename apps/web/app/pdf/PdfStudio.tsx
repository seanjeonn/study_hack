"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  ExtractionReportSchema,
  PageNoteResponseSchema,
  PageTextResponseSchema,
  PdfSummarySchema,
  type ExtractionReport,
  type PageTextResponse,
  type PdfSummary,
} from "@study-hack/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const RECOMMENDATION_LABEL: Record<ExtractionReport["recommendation"], string> = {
  ok: "Extraction quality looks good",
  consider_ocr: "Consider OCR (many pages have little or no text)",
  consider_llm_or_ocr: "Consider OCR/LLM (text may be garbled)",
};

export default function PdfStudio() {
  const [doc, setDoc] = useState<PdfSummary | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [pageText, setPageText] = useState<PageTextResponse | null>(null);
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Load the quality report (once per document).
  useEffect(() => {
    if (!doc) return;
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
  }, [doc]);

  // Load the current page's extracted text whenever the page changes.
  useEffect(() => {
    if (!doc) return;
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
  }, [doc, page]);

  // Re-read the page's note from disk on every page move, so an edit made
  // outside the app (Obsidian, an editor) is what the editor shows.
  useEffect(() => {
    if (!doc) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/pdf/${doc.id}/pages/${page}/note`);
        if (!res.ok) return;
        const parsed = PageNoteResponseSchema.parse(await res.json());
        if (active) setNote(parsed.content);
      } catch {
        // leave the note empty; saving still works
      }
    })();
    return () => {
      active = false;
    };
  }, [doc, page]);

  async function saveNote() {
    if (!doc || noteSaving) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const res = await fetch(`${API_URL}/pdf/${doc.id}/pages/${page}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `failed to save note (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      PageNoteResponseSchema.parse(await res.json());
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "failed to save note");
    } finally {
      setNoteSaving(false);
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
      const parsed = PdfSummarySchema.parse(await res.json());
      setDoc(parsed);
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
    setReport(null);
    setPageText(null);
    setPage(1);
    setError(null);
    setNote("");
    setNoteSaving(false);
    setNoteError(null);
  }

  if (!doc) {
    return (
      <section className="flex flex-col items-center gap-5 rounded-xl border border-[#e6e5e0] bg-white px-8 py-14 text-center">
        <p className="text-sm text-[#5a5852]">Choose a PDF file to get started.</p>
        <label className="cursor-pointer rounded-md bg-[#f54e00] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d04200]">
          {uploading ? "Reading the PDF…" : "Select PDF"}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={handleFile}
          />
        </label>
        {uploading ? (
          <p className="text-sm text-[#807d72]">Extracting text — this takes a moment.</p>
        ) : null}
        {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="truncate text-sm text-[#5a5852]" title={doc.filename}>
          {doc.filename}
        </p>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 rounded-md border border-[#cfcdc4] px-3 py-1.5 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8]"
        >
          New PDF
        </button>
      </div>

      {report ? <ExtractionReportPanel report={report} /> : null}

      <div className="flex flex-col gap-2 rounded-xl border border-[#e6e5e0] bg-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
          My note · page {page}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={noteSaving}
          placeholder={`Write your note for page ${page}…`}
          rows={6}
          className="w-full resize-y rounded-md border border-[#cfcdc4] bg-white px-3 py-2 font-mono text-[13px] text-[#26251e] placeholder:text-[#a09c92] disabled:opacity-50"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveNote()}
            disabled={noteSaving}
            className="w-fit rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {noteSaving ? "Saving…" : "Save"}
          </button>
          {noteError ? <p className="text-sm text-[#cf2d56]">{noteError}</p> : null}
        </div>
      </div>

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
            <PageTextPanel pageText={pageText?.pageNumber === page ? pageText : null} />
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

function PageTextPanel({ pageText }: { pageText: PageTextResponse | null }) {
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
