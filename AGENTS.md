> Coding & workflow guidance for AI agents (Claude Code / Codex) working in this repo.
> Business model, strategy, and data policy live **outside** this repo — this file is code/workflow only.

# study_hack

A single Next.js 16 app. Node 22, ESM, pnpm. No database, no Docker, no second
process: PDFs, notes, and concepts are files in a workspace folder the user owns.

## Working Principles

Guidelines to reduce common LLM coding mistakes. They bias toward caution over speed — for trivial tasks, use judgment.

**1. Think before coding.** Don't assume, don't hide confusion, surface tradeoffs. State your assumptions explicitly; if uncertain, ask. If multiple interpretations exist, present them — don't pick silently. If a simpler approach exists, say so. If something is unclear, stop, name what's confusing, and ask.

**2. Simplicity first.** Minimum code that solves the problem, nothing speculative. No features beyond what was asked, no abstractions for single-use code, no unrequested "flexibility" or "configurability", no error handling for impossible scenarios. If you write 200 lines and it could be 50, rewrite it. Ask: "Would a senior engineer call this overcomplicated?" — if yes, simplify.

**3. Surgical changes.** Touch only what you must; clean up only your own mess. Don't "improve" adjacent code, comments, or formatting; don't refactor what isn't broken; match existing style even if you'd do it differently. Remove imports/variables/functions that _your_ change orphaned — but leave pre-existing dead code (mention it, don't delete it). Every changed line should trace directly to the request.

**4. Goal-driven execution.** Define verifiable success criteria, then loop until they're met. "Fix the bug" → write a failing test that reproduces it, then make it pass. "Add validation" → write tests for invalid inputs, then make them pass. "Refactor X" → ensure tests pass before and after. For multi-step work, state a brief plan with a verify check per step. Strong criteria let you loop independently; weak criteria ("make it work") force constant clarification.

## Repository Layout

```
study_hack/
├── app/
│   ├── page.tsx               library: the PDFs in the workspace + upload
│   ├── pdfs/[id]/page.tsx     reader: image | extracted text | my note | AI note (?page=N)
│   ├── map/page.tsx           concept mindmap (@xyflow/react)
│   ├── components/            client components
│   └── api/…/route.ts         every server endpoint
├── lib/
│   ├── schemas.ts             zod wire schemas — client-safe, no node code
│   └── server/                node-only: fs · pdfjs · openai
├── bin/                       the published `study-hack` CLI (plain .mjs, no build step)
├── proxy/                     separate package: the beta AI relay, deployed by hand
├── scripts/                   repo maintenance .mjs (pack pruning, fixture generation)
├── tests/                     vitest suite (`pnpm test`)
└── workspace/                 user data — gitignored, $STUDY_WORKSPACE
```

- **`lib/server/` is node-only.** Every file there starts with `import "server-only"`, so a stray client import fails the build instead of leaking to the browser. Keep it that way when adding files.
- **`lib/schemas.ts` must stay importable from client components** — pure zod, nothing from `node:`.

## Development Commands

```bash
pnpm install
pnpm dev            # http://localhost:3000 (Turbopack)
pnpm build          # next build --webpack — see pitfall 2, this is not a preference
pnpm typecheck      # tsc --noEmit
pnpm lint
pnpm format         # prettier --write "."
pnpm format:check
pnpm test           # vitest run (watch mode: pnpm exec vitest)
```

**Verification chain** — after non-trivial changes, run in this order:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

If `typecheck` fails on something under `.next/types`, the route types are stale — run `pnpm build` (or delete `.next/dev`) and re-run.

## Code Conventions

Only what differs from defaults — Prettier and ESLint handle the rest.

- **Imports use the `@/` alias**: `import { … } from "@/lib/schemas"`. Do NOT add `.js` extensions — this app is bundler-resolved, so `./foo.js` is wrong here.
- **ESM only.** No `require()` in app code. (The one exception is the `createRequire` in `lib/server/textExtract.ts` — see pitfall 3 below. `bin/` and `scripts/` are plain `.mjs`, shipped and run unbundled, and are outside the `@/` alias.)
- **Node 22.** Pinned in `.nvmrc`.
- **Prettier:** `printWidth: 100`, `trailingComma: "all"`. Don't hand-tune line breaks — `pnpm format` is the source of truth.

## Boundary validation — three kinds

Nothing untrusted reaches the app unvalidated. There are three boundaries, and
all three are mandatory:

1. **HTTP in and out.** Parse request bodies and validate response payloads against `lib/schemas.ts` before returning them.
2. **LLM output.** Every model response is `JSON.parse`d and then `schema.parse`d before it is used or written to a file. Use strict `json_schema` response formats.
3. **Filesystem reads.** `meta.json` and every concept's frontmatter are files a user can edit or corrupt by hand. Always `safeParse` with a defined fallback — a rebuild for the cache, a skip-with-warning for a concept. **A broken file must never crash a request.**

## Workspace & user data

The workspace is the user's, not the app's. This is the product, not a detail.

- **The app owns `.cache/` only.** It is derived from `source.pdf` and can be rebuilt at any time.
- **`source.pdf`, `subject.md`, `notes/`, `ai/`, and `concepts/` are user data.** Never rewrite or delete them except where the user explicitly asked: a note entry is appended, or one entry is edited in place; an AI note appends a section; a concept refresh may only widen frontmatter and must leave the body untouched; a subject change rewrites only the `subject:` field and preserves the body.
- **Assume concurrent editors.** Obsidian, git, and other agents touch these files. Read fresh from disk rather than caching, and write through `atomicWrite`.
- **Paths are guarded in `lib/server/workspace.ts`.** Ids match `^[a-z0-9][a-z0-9-]{0,99}$`, resolved paths are re-checked against the workspace root, and page numbers are bounds-checked. Route new filesystem access through those helpers rather than joining paths yourself.

## AI call policy

- **Only on an explicit user action.** A button press. Never on upload, navigation, render, or any background job.
- **One button, one purpose.** The page-note generator annotates one page. The concept refresh is a separate button and must not ride along with anything else.
- **Cost stays visible.** The refresh reports its LLM call count. Keep that honest when changing it.
- **Missing key is not an error state for the app.** `getClient()` throws `LlmError(503)`; routes surface it as a clean 503 and write nothing. Reading, paging, and personal notes must keep working without a key.

## IMPORTANT — common pitfalls

**1. Next.js 16 differs from training data.** APIs, conventions, and file structure may all have changed. **Before writing new code, read the relevant guide under `node_modules/next/dist/docs/`.** Do not ignore deprecation warnings. In particular: route `params` are a Promise (`await ctx.params`), GET route handlers are uncached by default, and `export const runtime` should be left alone (Node is the default).

**2. The production build is webpack, and that is load-bearing.** `pnpm build` and `prepack` both run `next build --webpack`; only `pnpm dev` uses Turbopack. Turbopack resolves `serverExternalPackages` through hashed symlinks it writes into `.next/node_modules` (`pdf-to-img-a542cc51e3e05327 -> ../../node_modules/.pnpm/…`). Those point into this repo's pnpm store, and `npm pack` drops symlinks anyway, so a Turbopack `.next` cannot boot from a published tarball — it dies with `Failed to load external module pdf-to-img-<hash>`. Do not "modernize" the build back to Turbopack without re-running `--smoke` against a packed tarball.

**3. `createRequire` in `textExtract.ts` is reached through `process.getBuiltinModule`.** Both bundlers rewrite module ids, so `createRequire(import.meta.url).resolve(...)` returns an internal identifier rather than a filesystem path — anchoring at `process.cwd()` is what keeps pdfjs able to find its cMaps, without which CJK (Korean) text silently decodes to U+FFFD. The runtime lookup is needed on top of that because webpack statically parses `createRequire(…)` calls and stubs the call out when the argument is not a literal. `import.meta.resolve` is not available under either bundler.

**4. Native packages must stay external.** `pdfjs-dist`, `pdf-to-img`, and the canvas bindings are listed in `serverExternalPackages` in `next.config.ts`. Bundling them breaks their runtime asset and binding lookups. `pdfjs-dist` is pinned to `~5.6.205` to match `pdf-to-img`'s own range: with a wider range npm installs a second copy and pdfjs fails at render time with `The API version "…" does not match the Worker version "…"`. pnpm's lockfile hides this; the pack smoke workflow catches it.

**5. Packaging is verified by `--smoke`, not by `pnpm build`.** `bin/study-hack.mjs --smoke` starts the packaged server, uploads `tests/fixtures/ko-sample.pdf`, and asserts the Korean text round-trips with zero U+FFFD and that page 1 renders as a PNG. The fixture is hand-built (`scripts/makeKoFixture.mjs`) around a predefined CMap encoding precisely so it fails when the cMaps go missing; a PDF from a normal writer embeds its own ToUnicode map and would pass regardless. Run `.github/workflows/pack-smoke.yml` before any release.

## Design system

Before writing or changing any UI, read `DESIGN.md` and follow its color tokens,
typography, spacing, and component patterns. Treat it as the source of truth for
visual styling: warm cream canvas (`#f7f7f4`), warm near-black ink (`#26251e`),
Cursor Orange (`#f54e00`) used scarcely for primary CTAs only, hairline borders
with no drop shadows, and JetBrains Mono on every code surface.

## Branch / PR

- Long-lived branches: `main` (prod), `develop` (staging). No direct push; every change goes through a PR.
- Working branches: `<type>/<scope>-<kebab-desc>` — type ∈ `feature|fix|chore|hotfix`, scope ∈ `web|repo`.
- PR title = Conventional Commits (e.g. `feat(web): add a health endpoint`). On squash merge it becomes the commit message verbatim, so write it carefully.
- Merge style: feature/fix/chore → develop = **squash**, develop → main = **merge commit**, hotfix → main = **squash** plus an immediate main → develop back-merge (merge commit).
- **Releases are tagged.** After a develop → main release PR merges, tag the merge commit on main as `vX.Y.Z` (annotated, matching the `version` in `package.json` — bump it in the release when the shipped changes warrant) and push the tag: `git tag -a vX.Y.Z <merge-sha> && git push origin vX.Y.Z`. A release is not done until the tag is pushed.

## Releasing

Pushing a `v*` tag runs `.github/workflows/release.yml`: verify (ci.yml's
checks plus a guard that the tag matches `package.json`), the four-platform
pack smoke, then `npm publish --provenance` and `gh release create`. Nothing
else publishes, and the workflow is the only thing that should.

- **A version with a hyphen goes out under the `next` dist-tag**, never
  `latest`. That is what makes `v0.2.0-rc.0` a safe dry run — bump
  `package.json` to the rc version, tag it, watch the workflow, then bump to
  the real version and tag again.
- **The proxy is not released by CI.** It is deployed by hand from
  `proxy/README.md`, so no production key is ever handed to a workflow.

Two one-time setup steps, both outside this repo and both a human's job:

1. **Own `study-hack` on npm.** The name was unclaimed as of 2026-09-01; a
   publish from an account that does not own it fails. If it gets sniped, the
   fallback is `@study-hack/app` — which means changing `name` and `bin` in
   `package.json` and every `npx study-hack` in the docs.
2. **Give the workflow permission to publish.** Either configure npm Trusted
   Publishing for the package against this repo and `release.yml` (no secret
   at all — preferred), or add an automation-type `NPM_TOKEN` repository
   secret. The workflow already requests `id-token: write` and passes
   `NODE_AUTH_TOKEN`, so it works either way; drop the env line once trusted
   publishing is on.

## Don't

- ❌ Add `.js` extensions to relative imports — this is a bundler-resolved app, not tsc/NodeNext.
- ❌ Import anything from `lib/server/` into a client component.
- ❌ Return external or LLM output to the client without zod validation.
- ❌ Call a model without an explicit user action.
- ❌ Rewrite, reformat, or delete anything in the workspace outside `.cache/`.
