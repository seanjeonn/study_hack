"use client";

import { useState, type ChangeEvent } from "react";
import { PdfUploadResponseSchema, type PdfUploadResponse } from "@study-hack/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function PdfStudio() {
  const [doc, setDoc] = useState<PdfUploadResponse | null>(null);
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
