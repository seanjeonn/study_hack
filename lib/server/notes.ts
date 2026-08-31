import "server-only";

import fs from "node:fs/promises";
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
