"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { PdfSummarySchema } from "@/lib/schemas";

/**
 * Uploading blocks until the PDF is fully indexed — text extraction is
 * synchronous — so the button owns a spinner rather than a progress poller.
 */
export default function UploadButton() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
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
      {uploading ? (
        <p className="text-sm text-[#807d72]">Extracting text — this takes a moment.</p>
      ) : null}
      {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
    </div>
  );
}
