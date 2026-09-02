#!/usr/bin/env node
/**
 * The `npx study-hack` entry point.
 *
 * The whole trick of this file is one `process.chdir(packageRoot)`. The app is
 * shipped with a prebuilt `.next`, and two things in it resolve against the
 * process cwd: `next start` looks for `.next` there, and
 * `lib/server/textExtract.ts` anchors its pdfjs `createRequire` there to find
 * the cMap assets Korean text extraction needs. Running from the package root
 * satisfies both at once, with no code change in either.
 *
 * Which is why the workspace path is made absolute *before* the chdir — after
 * it, a relative `--workspace` would point somewhere the user never meant.
 *
 * Plain Node ESM: `bin/` ships to npm untouched, so `import.meta.url` here is a
 * real file URL (unlike inside the bundled app, where Turbopack rewrites it).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { choosePort, CliError, HELP, parseArgs, resolveWorkspace } from "./cliArgs.mjs";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(PACKAGE_ROOT, "package.json"));

/** Korean text the smoke fixture must round-trip through extraction. */
const SMOKE_EXPECTED = ["안녕하세요", "한국어", "기계학습"];

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

/** True when nothing else holds the port on the loopback interface. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Start the packaged Next server from the package root.
 *
 * `next` is spawned through its own JS entry point rather than a shell-resolved
 * `next` binary: the .bin shim is a symlink on POSIX and a .cmd on Windows, and
 * going straight to the file sidesteps both.
 */
function startServer(port, env) {
  const nextRoot = path.dirname(require.resolve("next/package.json"));
  const child = spawn(process.execPath, [path.join(nextRoot, "dist", "bin", "next"), "start"], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return child;
}

/** Poll the server until it answers, so the browser never opens on a dead port. */
async function waitForServer(port, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) throw new Error("the server exited before it started listening");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the server did not start within ${Math.round(timeoutMs / 1000)}s`);
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
