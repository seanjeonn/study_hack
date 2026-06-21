> Coding & workflow guidance for AI agents (Claude Code / Codex) working in this repo.
> Business model, strategy, and data policy live **outside** this repo — this file is code/workflow only.

# study_hack

pnpm 10.x monorepo · Node 22 · fully ESM. A TypeScript workspace (`apps/web`, `apps/api`, `packages/shared`).

## Working Principles

Guidelines to reduce common LLM coding mistakes. They bias toward caution over speed — for trivial tasks, use judgment.

**1. Think before coding.** Don't assume, don't hide confusion, surface tradeoffs. State your assumptions explicitly; if uncertain, ask. If multiple interpretations exist, present them — don't pick silently. If a simpler approach exists, say so. If something is unclear, stop, name what's confusing, and ask.

**2. Simplicity first.** Minimum code that solves the problem, nothing speculative. No features beyond what was asked, no abstractions for single-use code, no unrequested "flexibility" or "configurability", no error handling for impossible scenarios. If you write 200 lines and it could be 50, rewrite it. Ask: "Would a senior engineer call this overcomplicated?" — if yes, simplify.

**3. Surgical changes.** Touch only what you must; clean up only your own mess. Don't "improve" adjacent code, comments, or formatting; don't refactor what isn't broken; match existing style even if you'd do it differently. Remove imports/variables/functions that _your_ change orphaned — but leave pre-existing dead code (mention it, don't delete it). Every changed line should trace directly to the request.

**4. Goal-driven execution.** Define verifiable success criteria, then loop until they're met. "Fix the bug" → write a failing test that reproduces it, then make it pass. "Add validation" → write tests for invalid inputs, then make them pass. "Refactor X" → ensure tests pass before and after. For multi-step work, state a brief plan with a verify check per step. Strong criteria let you loop independently; weak criteria ("make it work") force constant clarification.

## Repository Layout

```
study_hack/                 pnpm 10.x monorepo, Node 22, fully ESM
├── apps/
│   ├── web/                Next.js 16 (App Router, React 19, Tailwind 4)
│   └── api/                Express 5 + TS, tsx watch dev, dotenv
└── packages/
    └── shared/             @study-hack/shared — zod schemas + shared TS types (SSOT for web/api)
```

Principles:

- **Frontend (web) lives only in `apps/web`**, backend logic only in `apps/api`, types and schemas shared by both only in `packages/shared`.
- New packages go under `packages/`. `pnpm-workspace.yaml` already covers `apps/*` and `packages/*`.

## Development Commands

Run from the repo root:

```bash
pnpm install            # bootstrap the entire workspace
pnpm dev                # run web + api together (parallel)
pnpm dev:web            # Next.js only (port 3000)
pnpm dev:api            # Express only (port 4000, override with PORT env var)

pnpm build              # build all packages
pnpm typecheck          # tsc --noEmit across all packages
pnpm lint               # eslint across all packages
pnpm format             # prettier --write "."
pnpm format:check       # CI / verification
```

For a single package, use `pnpm --filter ./apps/web <cmd>` or `pnpm --filter @study-hack/api <cmd>`. If you bypass the root scripts this way, build `@study-hack/shared` first (`pnpm --filter @study-hack/shared build`) — both apps import it via its `dist/` export map, so a missing/stale `dist` will surface as `Cannot find module '@study-hack/shared'`.

**Verification chain** — after non-trivial changes, run in this order:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build
```

`apps/api` doesn't have its own build step (it runs via `tsx watch`), but it still depends on `@study-hack/shared/dist`. The root `pnpm dev` / `pnpm typecheck` scripts rebuild `shared` first, so this is handled automatically. `apps/web` caches under `.next/`.

## Code Conventions

Only what differs from defaults — Prettier and ESLint handle the rest.

- **ESM only.** TS relative imports must use the `.js` extension: `import { foo } from "./foo.js"`. This is post-compile behavior; `.ts` and extensionless imports both fail.
- **Workspace imports use `@study-hack/<pkg>`.** Example: `import { ... } from "@study-hack/shared"`. Do not import another package via relative paths.
- **Node 22.** Pinned in `.nvmrc`. Do not use sub-20 features.
- **Prettier:** `printWidth: 100`, `trailingComma: "all"`. Do not hand-tune line breaks — `pnpm format` is the source of truth.
- **api is ESM** (`"type": "module"`). New files must also be ESM. No `require()`.
- **Validate external input at the boundary.** Any external or LLM response must pass `schema.parse()` (zod) before it is returned to the client — no unvalidated free-form payloads.

## IMPORTANT — common pitfalls

**1. Next.js 16 differs from training data.**
Per `apps/web/AGENTS.md`: APIs, conventions, and file structure may all have changed. **Before writing new code, read the relevant guide under `apps/web/node_modules/next/dist/docs/`.** Do not ignore deprecation warnings.

## Branch / PR

- Long-lived branches: `main` (prod), `develop` (staging). No direct push; every change goes through a PR.
- Working branches: `<type>/<scope>-<kebab-desc>` — type ∈ `feature|fix|chore|hotfix`, scope ∈ `web|api|shared|repo`.
- PR title = Conventional Commits (e.g. `feat(api): add health endpoint`). On squash merge it becomes the commit message verbatim, so write it carefully.
- Merge style: feature/fix/chore → develop = **squash**, develop → main = **merge commit**, hotfix → main = **squash** plus an immediate main → develop back-merge (merge commit).

## Don't

- ❌ Run `pnpm install` from inside an individual package directory — always from the root.
- ❌ Import another package via relative paths (`../../shared/...`) — use `@study-hack/shared`.
- ❌ Use `require(...)` in `apps/api` — ESM only.
- ❌ Return external/LLM output to the client without zod validation.
- ❌ Add new dependencies to the root `package.json` — add them to the consumer (app/package).
