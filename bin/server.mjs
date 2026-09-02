/**
 * Starting the packaged Next server, shared by the CLI and the Electron shell.
 *
 * These three functions used to live in `bin/study-hack.mjs`. They moved here
 * when the desktop shell appeared, because `desktop/main.js` needs exactly the
 * same start-and-wait sequence and must not reimplement it — a second copy is a
 * second place for the cwd rule below to be got wrong.
 *
 * Plain Node ESM: `bin/` ships to npm untouched, so `import.meta.url` here is a
 * real file URL (unlike inside the bundled app, where the bundler rewrites it).
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The installed package root — the directory holding `.next` and `package.json`. */
export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const require = createRequire(path.join(PACKAGE_ROOT, "package.json"));

/** True when nothing else holds the port on the loopback interface. */
export function isPortFree(port) {
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
 *
 * `cwd` is the package root and not the caller's directory, because two things
 * resolve against it: `next start` looks for `.next` there, and
 * `lib/server/textExtract.ts` anchors its pdfjs `createRequire` there to find
 * the cMap assets Korean extraction needs.
 *
 * `ELECTRON_RUN_AS_NODE` is set explicitly rather than inherited. Under the
 * desktop shell `process.execPath` is the Electron binary, and a GUI Electron
 * parent does not have that variable in its own environment — without it here
 * the child would boot a second windowed Electron instead of a Next server.
 * Under plain `node` it is simply ignored.
 */
export function startServer(port, env) {
  const nextRoot = path.dirname(require.resolve("next/package.json"));
  const child = spawn(process.execPath, [path.join(nextRoot, "dist", "bin", "next"), "start"], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env, PORT: String(port) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return child;
}

/** Poll the server until it answers, so the browser never opens on a dead port. */
export async function waitForServer(port, child, timeoutMs = 60_000) {
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
