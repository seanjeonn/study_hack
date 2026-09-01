"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { PdfSummarySchema } from "@/lib/schemas";

/**
 * Uploading blocks until the PDF is fully indexed — text extraction is
 * synchronous — so the button owns a spinner rather than a progress poller.
 *
 * The subject field is a free-text input backed by a datalist of the subjects
 * already in use: picking an existing one and typing a new one are the same
 * gesture, and typing stays IME-safe. Leaving it empty uploads ungrouped.
 */
export default function UploadButton({ subjects }: { subjects: string[] }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("subject", subject.trim());
      const res = await fetch("/api/pdfs", { method: "POST", body });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `upload failed (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      const parsed = PdfSummarySchema.parse(await res.json());
      router.push(`/pdfs/${parsed.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="cursor-pointer rounded-md bg-[#f54e00] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d04200]">
          {uploading ? "Reading the PDF…" : "Add a PDF"}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={handleFile}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
            Subject (optional)
          </span>
          <input
            type="text"
            list="upload-subjects"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={uploading}
            placeholder="e.g. 기계학습"
            className="h-11 rounded-md border border-[#e6e5e0] bg-white px-4 text-sm text-[#26251e] placeholder:text-[#a09c92]"
          />
        </label>
        <datalist id="upload-subjects">
          {subjects.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      {uploading ? (
        <p className="text-sm text-[#807d72]">Extracting text — this takes a moment.</p>
      ) : null}
      {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
    </div>
  );
}
