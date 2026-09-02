/**
 * Build the payload the Electron shell ships around.
 *
 * `npm pack` the repo root, then install that tarball with plain npm into a
 * throwaway consumer directory — the exact shape `.github/workflows/pack-smoke.yml`
 * uses, and for the same reason: the failures live in the gap between the
 * repo's pnpm layout and a user's npm one. What electron-builder copies into
 * `Resources/app` is therefore the same tree `npx study-hack` would install.
 *
 * Output: `desktop/build/payload` (gitignored), holding
 * `node_modules/study-hack` and its production dependencies.
 *
 * Local build and CI both call this, so there is one definition of "the
 * payload" rather than a script and a workflow that drift apart.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(DESKTOP_DIR);
const BUILD_DIR = path.join(DESKTOP_DIR, "build");
const PACK_DIR = path.join(BUILD_DIR, "pack");
const PAYLOAD_DIR = path.join(BUILD_DIR, "payload");

/** npm, spelt the way Windows needs it. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, cwd) {
  console.log(`[payload] ${cmd} ${args.join(" ")}  (in ${cwd})`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(PACK_DIR, { recursive: true });
fs.mkdirSync(PAYLOAD_DIR, { recursive: true });

// `prepack` runs `next build --webpack` — webpack and not Turbopack, because a
// Turbopack `.next` resolves external packages through symlinks into this
// repo's pnpm store and cannot boot anywhere else. See AGENTS.md, pitfall 2.
run(NPM, ["pack", "--pack-destination", PACK_DIR], REPO_ROOT);

const tarball = fs.readdirSync(PACK_DIR).find((name) => name.endsWith(".tgz"));
if (!tarball) throw new Error(`npm pack produced no tarball in ${PACK_DIR}`);

run(NPM, ["init", "-y"], PAYLOAD_DIR);
run(
  NPM,
  ["install", "--omit=dev", "--no-audit", "--no-fund", path.join(PACK_DIR, tarball)],
  PAYLOAD_DIR,
);

const installed = path.join(PAYLOAD_DIR, "node_modules", "study-hack");
if (!fs.existsSync(path.join(installed, "bin", "server.mjs"))) {
  throw new Error(`the payload at ${installed} is missing bin/server.mjs`);
}
console.log(`[payload] ready: ${installed}`);
