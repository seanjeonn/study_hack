"use client";

import { useEffect, useState } from "react";
import { PageNoteResponseSchema, type NoteEntry } from "@/lib/schemas";

/**
 * The page's note, kept as a transcript: each line you write is appended as its
 * own timestamped section in one markdown file you own, and any single entry
 * can be edited afterwards. The note is re-read from disk on every page move,
 * so an edit made in another editor wins over whatever this component held.
 */
export default function PageNoteEditor({ pdfId, page }: { pdfId: string; page: number }) {
  const [entries, setEntries] = useState<NoteEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/pdfs/${pdfId}/pages/${page}/note`);
        if (!res.ok) throw new Error(`failed to load note (${res.status})`);
        // Validate the inbound payload at the boundary before trusting it.
        const parsed = PageNoteResponseSchema.parse(await res.json());
        if (!active) return;
        setEntries(parsed.entries);
        setError(null);
      } catch {
        if (active) setError("could not load this page's note");
      } finally {
        if (active) {
          setLoaded(true);
          setEditingId(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [pdfId, page]);

  async function send(method: "POST" | "PUT", body: unknown): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/pdfs/${pdfId}/pages/${page}/note`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `failed to save (${res.status})`);
      }
      const parsed = PageNoteResponseSchema.parse(await res.json());
      setEntries(parsed.entries);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save this note");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function add() {
    if (!draft.trim()) return;
    if (await send("POST", { content: draft })) setDraft("");
  }

  async function saveEdit(entryId: string) {
    if (!editDraft.trim()) return;
    if (await send("PUT", { entryId, content: editDraft })) setEditingId(null);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#e6e5e0] bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.88px] text-[#807d72]">
          My note · page {page}
        </span>
        <span className="font-mono text-[11px] text-[#a09c92]">
          notes/page-{String(page).padStart(3, "0")}.md
        </span>
      </div>

      <div className="flex max-h-[32vh] flex-col gap-3 overflow-auto">
        {entries.length === 0 ? (
          <p className="text-sm text-[#807d72]">
            {loaded ? "No note yet. Write your first line." : "Loading…"}
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[11px] text-[#a09c92]">
                  {entry.id || "earlier note"}
                </span>
                {editingId === entry.id ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditDraft(entry.content);
                    }}
                    className="text-[11px] font-medium text-[#5a5852] transition-colors hover:text-[#26251e]"
                  >
                    Edit
                  </button>
                )}
              </div>
              {editingId === entry.id ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={4}
                    className="w-full resize-y rounded-md border border-[#cfcdc4] bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-[#26251e]"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void saveEdit(entry.id)}
                      disabled={!editDraft.trim() || pending}
                      className="rounded-md border border-[#cfcdc4] px-3 py-1.5 text-sm text-[#26251e] transition-colors hover:bg-[#efeee8] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-sm text-[#5a5852] transition-colors hover:text-[#26251e]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#26251e]">
                  {entry.content}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-[#efeee8] pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          disabled={!loaded}
          placeholder={`Write a note for page ${page}…`}
          rows={3}
          className="w-full resize-y rounded-md border border-[#cfcdc4] bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-[#26251e] placeholder:text-[#a09c92] disabled:opacity-50"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void add()}
            disabled={!draft.trim() || pending}
            className="w-fit rounded-md bg-[#f54e00] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d04200] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add"}
          </button>
          <span className="text-xs text-[#a09c92]">⌘↵</span>
          {error ? <p className="text-sm text-[#cf2d56]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
