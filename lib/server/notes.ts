import "server-only";

import fs from "node:fs/promises";
import type { NoteEntry } from "@/lib/schemas";
import { atomicWrite, pageNotePath } from "@/lib/server/workspace";

/**
 * Per-page user notes: one editable markdown file per page
 * (`notes/page-NNN.md`), owned by the user. The app only ever reads the file
 * fresh and overwrites it on an explicit save, so editing the same file in
 * Obsidian or an editor stays valid.
 */
export async function readPageNote(id: string, pageNumber: number): Promise<string> {
  try {
    return await fs.readFile(pageNotePath(id, pageNumber), "utf8");
  } catch (err) {
    // A page simply has no note yet — an empty note is the correct answer.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

export async function writePageNote(
  id: string,
  pageNumber: number,
  content: string,
): Promise<void> {
  await atomicWrite(pageNotePath(id, pageNumber), content);
}

/**
 * A note reads as a transcript: each entry is a `## YYYY-MM-DD HH:MM:SS`
 * section, and that heading is the entry's id. Only a complete timestamp
 * counts as a boundary, so the reader's own `## Graph theory` heading stays
 * inside the entry it was written in.
 */
const ENTRY_HEADING = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})[ \t]*$/;

/**
 * Split a note file into entries. Anything above the first timestamp heading
 * becomes a single entry with an empty id — which is how a flat note written
 * before this format, or by hand in Obsidian, reads. Nothing here can fail: a
 * file the user mangled still shows up, it just shows up as one entry.
 */
export function parseNoteEntries(raw: string): NoteEntry[] {
  const entries: NoteEntry[] = [];
  let id: string | null = null;
  let lines: string[] = [];

  const flush = () => {
    const content = lines.join("\n").trim();
    if (id === null) {
      if (content) entries.push({ id: "", content });
    } else {
      entries.push({ id, content });
    }
    lines = [];
  };

  for (const line of raw.split("\n")) {
    const match = ENTRY_HEADING.exec(line);
    if (match) {
      flush();
      id = match[1];
    } else {
      lines.push(line);
    }
  }
  flush();
  return entries;
}

/** Serialize entries back to the on-disk markdown. */
export function renderNoteEntries(entries: NoteEntry[]): string {
  const sections = entries.map((entry) =>
    entry.id ? `## ${entry.id}\n\n${entry.content.trim()}` : entry.content.trim(),
  );
  return sections.length > 0 ? `${sections.join("\n\n")}\n` : "";
}

/**
 * The stamp for a new entry, in local time — a note is read by the person who
 * wrote it, so it carries their clock. Stepping forward a second past any
 * stamp the file already uses keeps ids unique within a file.
 */
export function entryStamp(now: Date, taken: Set<string>): string {
  const at = new Date(now.getTime());
  let stamp = formatStamp(at);
  while (taken.has(stamp)) {
    at.setSeconds(at.getSeconds() + 1);
    stamp = formatStamp(at);
  }
  return stamp;
}

function formatStamp(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

export async function readNoteEntries(id: string, pageNumber: number): Promise<NoteEntry[]> {
  return parseNoteEntries(await readPageNote(id, pageNumber));
}

/**
 * Append one entry. The existing file is concatenated, never re-serialized, so
 * every byte the reader already wrote survives verbatim.
 */
export async function appendNoteEntry(
  id: string,
  pageNumber: number,
  content: string,
): Promise<NoteEntry[]> {
  const raw = await readPageNote(id, pageNumber);
  const taken = new Set(parseNoteEntries(raw).map((entry) => entry.id));
  const section = `## ${entryStamp(new Date(), taken)}\n\n${content.trim()}\n`;
  const next = raw.trim() ? `${raw.trimEnd()}\n\n${section}` : section;
  await writePageNote(id, pageNumber, next);
  return parseNoteEntries(next);
}

/**
 * Replace one entry's body. Returns undefined when the id is gone — the file
 * was edited elsewhere and the heading changed, so the client reloads instead
 * of writing over what is now someone else's entry.
 */
export async function updateNoteEntry(
  id: string,
  pageNumber: number,
  entryId: string,
  content: string,
): Promise<NoteEntry[] | undefined> {
  const entries = await readNoteEntries(id, pageNumber);
  const index = entries.findIndex((entry) => entry.id === entryId);
  if (index === -1) return undefined;
  const next = entries.map((entry, i) =>
    i === index ? { ...entry, content: content.trim() } : entry,
  );
  await writePageNote(id, pageNumber, renderNoteEntries(next));
  return next;
}
