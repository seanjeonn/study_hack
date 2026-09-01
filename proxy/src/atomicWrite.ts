import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Write a file via a temp file + rename, so a reader never sees a half-written
 * file.
 *
 * A deliberate ten-line copy of `atomicWrite` in `lib/server/workspace.ts`.
 * That module starts with `import "server-only"`, which throws outside a React
 * Server Component, and this process is a plain `node:http` server with no
 * React in it at all — importing it is not possible, and importing the app to
 * get one helper would drag Next in behind it. Keep the two in step by hand.
 */
export async function atomicWrite(filePath: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
