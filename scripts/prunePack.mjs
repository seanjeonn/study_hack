#!/usr/bin/env node
/**
 * Drop the scratch directories under `.next` before the tarball is built.
 *
 * `files` in package.json ships all of `.next`, and most of what lands there
 * is not the app:
 *
 * - `cache/` — the build cache `prepack`'s `next build` leaves behind. ~140 MB.
 * - `dev/` — Turbopack's dev-server output, from whenever the maintainer last
 *   ran `pnpm dev`. ~33 MB, and it does not even come from this build, so
 *   whether it ships depends on what the packer happened to do that morning.
 * - `trace`, `trace-build` — build telemetry.
 *
 * `next start` reads none of it. Without this the published tarball is 7.7 MB
 * instead of 1 MB, and every `npx study-hack` pays for it.
 *
 * Usage: node scripts/prunePack.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRATCH = ["cache", "dev", "trace", "trace-build"];

const next = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), ".next");

for (const name of SCRATCH) {
  const target = path.join(next, name);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`pruned .next/${name}`);
  }
}
