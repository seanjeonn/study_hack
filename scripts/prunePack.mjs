#!/usr/bin/env node
/**
 * Drop `.next/cache` before the tarball is built.
 *
 * `prepack` runs a full `next build`, which leaves a webpack/Turbopack cache
 * behind. It is pure build scratch — hundreds of megabytes of it — and
 * `next start` never reads it, so shipping it to every `npx study-hack` user
 * would be a pointless download.
 *
 * Usage: node scripts/prunePack.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = path.join(root, ".next", "cache");

if (fs.existsSync(cache)) {
  fs.rmSync(cache, { recursive: true, force: true });
  console.log(`pruned ${cache}`);
}
