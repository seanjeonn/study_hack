"use client";

import { useCallback, useEffect, useState } from "react";
import { PageNoteResponseSchema } from "@/lib/schemas";

/**
 * The page's note: one markdown file the user owns. Saving is explicit (button
 * or ⌘S) and the note is re-read from disk on every page move, so an edit made
 * in another editor wins over whatever this component last held.
 */
export default function PageNoteEditor({ pdfId, page }: { pdfId: string; page: number }) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/pdfs/${pdfId}/pages/${page}/note`);
        if (!res.ok) throw new Error(`failed to load note (${res.status})`);
        const parsed = PageNoteResponseSchema.parse(await res.json());
        if (!active) return;
        setContent(parsed.content);
        setError(null);
      } catch {
        if (active) setError("could not load this page's note");
      } finally {
        if (active) {
          setLoaded(true);
          setSavedAt(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [pdfId, page]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/pdfs/${pdfId}/pages/${page}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `failed to save note (${res.status})`);
      }
      // Validate the inbound payload at the boundary before trusting it.
      PageNoteResponseSchema.parse(await res.json());
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save note");
    } finally {
      setSaving(false);
    }
  }, [pdfId, page, content]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#e6e5e0] bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
          My note · page {page}
        </span>
        <span className="font-mono text-[11px] text-[#a09c92]">
          notes/page-{String(page).padStart(3, "0")}.md
        </span>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            void save();
          }
        }}
        disabled={!loaded || saving}
        placeholder={`Write your note for page ${page}…`}
        rows={10}
        className="w-full resize-y rounded-md border border-[#cfcdc4] bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-[#26251e] placeholder:text-[#a09c92] disabled:opacity-50"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!loaded || saving}
          className="w-fit rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <span className="text-xs text-[#a09c92]">⌘S</span>
        {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
        {!error && savedAt ? <p className="text-sm text-[#1f8a65]">Saved at {savedAt}</p> : null}
      </div>
    </div>
  );
}
