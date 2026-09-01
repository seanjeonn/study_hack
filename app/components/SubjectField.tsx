"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PdfSummarySchema } from "@/lib/schemas";

/**
 * The subject a PDF is grouped under, editable from the reader header. Reads as
 * a badge until clicked, then a free-text input backed by the subjects already
 * in use. Saving an empty value ungroups the PDF.
 *
 * Never orange: this is a quiet metadata control, not a primary action.
 */
export default function SubjectField({
  pdfId,
  subject: initialSubject,
  subjects,
}: {
  pdfId: string;
  subject?: string;
  subjects: string[];
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [draft, setDraft] = useState(initialSubject ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraft(subject);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pdfs/${pdfId}/subject`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: draft.trim() }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `could not save the subject (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      const parsed = PdfSummarySchema.parse(await res.json());
      setSubject(parsed.subject ?? "");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not save the subject");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {subject ? (
          <button
            type="button"
            onClick={startEditing}
            className="rounded-full bg-[#e6e5e0] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.88px] text-[#26251e] transition-colors hover:bg-[#cfcdc4]"
          >
            {subject}
          </button>
        ) : (
          <button
            type="button"
            onClick={startEditing}
            className="text-sm text-[#807d72] transition-colors hover:text-[#26251e]"
          >
            Add a subject
          </button>
        )}
        {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        list="reader-subjects"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={saving}
        placeholder="e.g. 기계학습"
        className="h-9 rounded-md border border-[#e6e5e0] bg-white px-3 text-sm text-[#26251e] placeholder:text-[#a09c92]"
      />
      <datalist id="reader-subjects">
        {subjects.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="h-9 rounded-md border border-[#cfcdc4] bg-white px-3 text-sm font-medium text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={saving}
        className="text-sm font-medium text-[#5a5852] transition-colors hover:text-[#26251e]"
      >
        Cancel
      </button>
      {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
    </div>
  );
}
