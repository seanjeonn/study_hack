#!/usr/bin/env node
/**
 * The `npx study-hack` entry point.
 *
 * Argument parsing lives in `./cliArgs.mjs` and the server child in
 * `./server.mjs` — the latter because the Electron shell in `desktop/` starts
 * the very same server and must not carry a second copy of the rules about
 * cwd and the child environment. What is left here is the CLI itself: parse,
 * pick a workspace, start, print, and the release self-check.
 *
 * Plain Node ESM: `bin/` ships to npm untouched, so `import.meta.url` there is
 * a real file URL (unlike inside the bundled app, where Turbopack rewrites it).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { choosePort, CliError, HELP, parseArgs, resolveWorkspace } from "./cliArgs.mjs";
import { isPortFree, PACKAGE_ROOT, startServer, waitForServer } from "./server.mjs";

/** Korean text the smoke fixture must round-trip through extraction. */
const SMOKE_EXPECTED = ["안녕하세요", "한국어", "기계학습"];

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Opening a browser is a convenience; the URL is printed either way.
  }
}

async function serve(options) {
  const workspace = resolveWorkspace(
    options.workspace,
    process.env.STUDY_WORKSPACE,
    os.homedir(),
    (...parts) => path.resolve(process.cwd(), ...parts),
  );
  await fsp.mkdir(workspace, { recursive: true });
  const port = await choosePort(options.port, isPortFree);
  const url = `http://localhost:${port}`;

  const child = startServer(port, { STUDY_WORKSPACE: workspace });
  // Ctrl-C in the user's terminal reaches the child too (same process group);
  // this only makes sure we do not outlive it, and vice versa.
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code, signal) => process.exit(signal ? 0 : (code ?? 0)));

  await waitForServer(port, child);
  console.log(`\n  study-hack ${readVersion()}`);
  console.log(`  ${url}`);
  console.log(`  workspace: ${workspace}\n`);
  if (options.open) openBrowser(url);
}

/**
 * The self-check that gates every release.
 *
 * It runs the *packaged* server end to end — start it from the tarball, upload
 * the bundled Korean PDF, read the extracted text back, and render page 1 as a
 * PNG. That covers all three things a bad pack breaks: a `.next` that will not
 * boot elsewhere, pdfjs cMaps that went missing (Korean silently becomes
 * U+FFFD, or disappears entirely), and a native canvas binding that did not
 * install on this platform.
 */
async function smoke() {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "study-hack-smoke-"));
  const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), "study-hack-smoke-config-"));
  // The app is behind a Google sign-in, and every API the smoke calls is
  // gated. There is deliberately no bypass flag in the product — a way to skip
  // the gate is a way for a user to end up skipping it — so the smoke seeds a
  // session the same way signing in would, in a throwaway config directory.
  // That isolation also stops the run from reading (or writing) the developer's
  // own ~/.study-hack, which is where a real key lives.
  await fsp.writeFile(
    path.join(configDir, "session.json"),
    `${JSON.stringify(
      {
        sub: "smoke-test",
        email: "smoke@study-hack.invalid",
        signedInAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  const port = await choosePort(null, isPortFree);
  const fixture = path.join(PACKAGE_ROOT, "tests", "fixtures", "ko-sample.pdf");
  const child = startServer(port, {
    STUDY_WORKSPACE: workspace,
    STUDY_CONFIG_DIR: configDir,
    OPENAI_API_KEY: "",
  });
  const base = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(port, child);
    console.log(`[smoke] server up on ${base}`);

    const form = new FormData();
    form.set(
      "file",
      new Blob([await fsp.readFile(fixture)], { type: "application/pdf" }),
      "ko-sample.pdf",
    );
    const upload = await fetch(`${base}/api/pdfs`, { method: "POST", body: form });
    if (upload.status !== 201) {
      throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
    }
    const { id, pageCount } = await upload.json();
    console.log(`[smoke] uploaded id=${id} pages=${pageCount}`);

    const textRes = await fetch(`${base}/api/pdfs/${id}/pages/1/text`);
    if (!textRes.ok) throw new Error(`text fetch failed: ${textRes.status}`);
    const { text } = await textRes.json();

    const replacements = [...text].filter((ch) => ch.codePointAt(0) === 0xfffd).length;
    if (replacements > 0) {
      throw new Error(`extracted text has ${replacements} U+FFFD chars — pdfjs cMaps are missing`);
    }
    const missing = SMOKE_EXPECTED.filter((word) => !text.includes(word));
    if (missing.length > 0) {
      throw new Error(
        `extracted text is missing Korean: ${missing.join(", ")} — got ${JSON.stringify(text)}`,
      );
    }
    console.log(`[smoke] korean text ok (${text.trim().length} chars, 0 U+FFFD)`);

    const png = await fetch(`${base}/api/pdfs/${id}/pages/1`);
    if (!png.ok) throw new Error(`page render failed: ${png.status}`);
    const bytes = Buffer.from(await png.arrayBuffer());
    if (bytes.length < 1000 || bytes.subarray(1, 4).toString("latin1") !== "PNG") {
      throw new Error(`page render did not return a PNG (${bytes.length} bytes)`);
    }
    console.log(`[smoke] page render ok (${bytes.length} bytes)`);
    console.log("[smoke] PASS");
  } finally {
    child.kill("SIGTERM");
    await fsp.rm(workspace, { recursive: true, force: true });
    await fsp.rm(configDir, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  switch (options.command) {
    case "help":
      console.log(HELP);
      return;
    case "version":
      console.log(readVersion());
      return;
    case "smoke":
      await smoke();
      return;
    default:
      await serve(options);
  }
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`study-hack: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
