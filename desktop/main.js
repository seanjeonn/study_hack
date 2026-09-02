/**
 * The Electron main process.
 *
 * This shell owns no product code. It starts the very same packaged Next
 * server `npx study-hack` starts — same tarball, same `bin/server.mjs`, same
 * cwd rules — and points a window at it. Everything the user sees is served
 * over loopback by that child.
 *
 * Two things are load-bearing and easy to get wrong:
 *
 * 1. The payload lives *outside* the asar. `extraResources` puts the installed
 *    tarball at `Resources/app`, because the child needs real files on disk:
 *    a native canvas binding to dlopen, pdfjs cMap directories to read, and a
 *    JS entry point to spawn. None of that works from inside an archive.
 * 2. The child is spawned with `process.execPath`, which here is the Electron
 *    binary. `bin/server.mjs` sets `ELECTRON_RUN_AS_NODE=1` in the child env so
 *    it boots as Node instead of a second windowed Electron. Do not disable the
 *    `RunAsNode` fuse — it is what makes that work.
 *
 * ESM, like the rest of the repo — Electron has supported an ESM main process
 * since v28, and the payload's entry points are ESM anyway.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, shell } from "electron";

/**
 * Where the installed `study-hack` package lives.
 *
 * Packaged: beside the asar, put there by `extraResources`. In development:
 * whatever `desktop/scripts/build-payload.mjs` produced, named by
 * `STUDY_DESKTOP_APP_ROOT` so a developer can point the shell at a payload
 * built from an unpublished tarball.
 */
function resolvePayloadRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app", "node_modules", "study-hack");
  }
  const fromEnv = process.env.STUDY_DESKTOP_APP_ROOT;
  if (!fromEnv) {
    throw new Error(
      "STUDY_DESKTOP_APP_ROOT is not set — run `node scripts/build-payload.mjs` and point it at " +
        "build/payload/node_modules/study-hack",
    );
  }
  return path.resolve(fromEnv);
}

/** The spawned `next start`. Killed on quit; nothing else may outlive the window. */
let serverChild = null;
let mainWindow = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    title: "study_hack",
    backgroundColor: "#f7f7f4",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(import.meta.dirname, "preload.js"),
    },
  });

  // Google refuses to sign a user in inside an embedded webview, so the whole
  // OAuth trip has to leave for the system browser. `/api/auth/start` is opened
  // with target=_blank, which arrives here; the callback lands back on the
  // loopback server, and the login page's poll moves this window along.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  // Same rule for a plain link click: anything that is not our own loopback
  // server leaves for the browser rather than replacing the app with a web page.
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.loadURL(url);
}

async function start() {
  const payloadRoot = resolvePayloadRoot();
  const binDir = path.join(payloadRoot, "bin");
  if (!fs.existsSync(path.join(binDir, "server.mjs"))) {
    throw new Error(`no study-hack payload at ${payloadRoot}`);
  }

  const { choosePort, resolveWorkspace } = await import(
    pathToFileURL(path.join(binDir, "cliArgs.mjs")).href
  );
  const { isPortFree, startServer, waitForServer } = await import(
    pathToFileURL(path.join(binDir, "server.mjs")).href
  );

  // `STUDY_WORKSPACE` is honoured so the app can be launched against a scratch
  // directory; `STUDY_CONFIG_DIR` needs no handling here because `startServer`
  // spreads `process.env` into the child.
  const workspace = resolveWorkspace(
    null,
    process.env.STUDY_WORKSPACE,
    app.getPath("home"),
    (...parts) => path.resolve(...parts),
  );
  fs.mkdirSync(workspace, { recursive: true });

  const port = await choosePort(null, isPortFree);
  serverChild = startServer(port, { STUDY_WORKSPACE: workspace });
  const url = `http://127.0.0.1:${port}/`;
  await waitForServer(port, serverChild);
  createWindow(url);
}

function stopServer() {
  if (serverChild && serverChild.exitCode === null) serverChild.kill("SIGTERM");
  serverChild = null;
}

// A second launch must not start a second server: it would take the next free
// port, and an OAuth callback aimed at the first one would arrive nowhere.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() =>
    start().catch((err) => {
      console.error(err);
      app.quit();
    }),
  );

  // Quit on every platform, macOS included. The usual mac convention of
  // staying resident does not apply: closing the window has to take the
  // server down with it, and a headless leftover serving the user's notes on
  // localhost is worse than an app that does not linger in the dock.
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", stopServer);
  app.on("will-quit", stopServer);
}
