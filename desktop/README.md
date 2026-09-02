# study_hack desktop

The Electron shell. It contains no product code: it starts the same packaged
Next server `npx study-hack` starts, and points a window at it. Your PDFs and
notes stay files on your disk, in `~/study-hack`.

Private package, not published to npm, not part of the root `files` list.

## How it fits together

```
study_hack.app/Contents/Resources/
├── app.asar          main.js + preload.js — this package
└── app/              the `study-hack` tarball, installed with plain npm
    └── node_modules/study-hack/{.next,bin,public,...}
```

`main.js` imports `choosePort`/`resolveWorkspace` from the payload's
`bin/cliArgs.mjs` and `isPortFree`/`startServer`/`waitForServer` from its
`bin/server.mjs`, so the shell and the CLI start the server the same way.

Three things are load-bearing:

- **The payload lives outside the asar.** The native canvas binding is
  `dlopen`'d, the pdfjs cMaps are read as directories, and `next start` is
  spawned as a child process. None of that works from inside an archive.
- **The child runs as Node.** It is spawned with `process.execPath`, which here
  is the Electron binary; `bin/server.mjs` sets `ELECTRON_RUN_AS_NODE=1` in the
  child environment. Do not disable the `RunAsNode` fuse.
- **The build is webpack.** `npm pack` runs `prepack` → `next build --webpack`.
  A Turbopack `.next` resolves external packages through symlinks into this
  repo's pnpm store and cannot boot from a packed tarball. See AGENTS.md,
  pitfall 2.

## Build it locally

```bash
cd desktop
npm install                      # electron + electron-builder
node scripts/build-payload.mjs   # npm pack the root, npm install it into build/payload
npx electron-builder --config electron-builder.yml
```

The installer lands in `desktop/dist/` — a `.dmg` on macOS, an NSIS `.exe` on
Windows. Both are unsigned; `README.md` at the repo root tells users how to get
past Gatekeeper and SmartScreen.

Before packaging, run the self-check against Electron's own Node ABI — the
check that the native modules survive the move off plain Node:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
  build/payload/node_modules/study-hack/bin/study-hack.mjs --smoke
```

It must print `korean text ok … 0 U+FFFD`, `page render ok`, and `PASS`.

## Run the shell without packaging

```bash
node scripts/build-payload.mjs
STUDY_DESKTOP_APP_ROOT="$PWD/build/payload/node_modules/study-hack" \
  npx electron .
```

`STUDY_WORKSPACE` and `STUDY_CONFIG_DIR` are honoured at launch, packaged or
not, which is how you point a build at a scratch directory instead of your real
notes.

## Not done here

No code signing, no notarization, no auto-update, no Linux target. CI builds
macOS arm64, macOS x64 and Windows x64 (`.github/workflows/desktop.yml`) and
attaches the artifacts to the GitHub release.
