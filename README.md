# study_hack

A local study app for reading PDFs. You keep a note on every page, ask for an AI
second read when you actually want one, and get a map of the concepts your
documents share.

Everything it produces is a plain file in a folder you choose. No database, no
account, no cloud — open the same notes in Obsidian, track them in git, point
Claude Code at them.

## Quick start

```bash
npx study-hack
```

That's it. It starts the app, opens your browser, and keeps your PDFs and notes
in `~/study-hack`. **Node 22+** is the only requirement — no database, no
Docker, no build step, no account.

```bash
npx study-hack --workspace ~/Documents/notes   # keep your files somewhere else
npx study-hack --port 4000                     # default: first free port from 3000
npx study-hack --no-open                       # don't open a browser
npx study-hack --smoke                         # self-check, then exit
npx study-hack --help
```

`--workspace` wins over the `STUDY_WORKSPACE` environment variable. Relative
paths resolve against the directory you ran the command from.

## Running from source

```bash
git clone <this-repo>
cd study_hack
pnpm install
cp .env.example .env
pnpm dev
```

Open http://localhost:3000, add a PDF, and start reading. This path needs
**pnpm 10+** as well as Node 22.

Uploading blocks for a second or two while the text is extracted — that is
deliberate. Doing it up front means there is no background job, no processing
state, and no spinner to wait on later.

The AI features need an API key (below). Everything else — reading, paging,
extracted text, and your own notes — works without one.

## Where your data lives

Set `--workspace` (or `STUDY_WORKSPACE`) to any folder. `npx study-hack`
defaults to `~/study-hack`; running from source defaults to `./workspace`,
which is gitignored.

```
workspace/
├── .gitignore                  excludes .cache/ — yours to edit
├── deep-learning-lecture-03/
│   ├── source.pdf              the PDF you uploaded
│   ├── subject.md              the subject it is grouped under — yours to edit
│   ├── notes/page-001.md       your notes — one file per page
│   ├── ai/page-014.md          AI notes, appended as timestamped sections
│   └── .cache/                 the app's own index — safe to delete
└── concepts/
    └── backpropagation.md      one concept, with frontmatter linking it to pages
```

**You own everything except `.cache/`.** That folder is derived data: delete it
and the app rebuilds it from `source.pdf` on the next request. Which also means
you can drop a PDF into a new folder by hand and the app will pick it up.

**Subjects.** A PDF can be filed under a subject — free text like `기계학습`,
set when you upload it or from the badge in the reader header. It lives in that
PDF's `subject.md` as one line of frontmatter, so it survives deleting the cache
and you can set it by hand. The library and the sidebar group by it, and the
concept map can be narrowed to a single subject. A PDF with no `subject.md` is
simply ungrouped.

Because it is all just markdown:

- **git** — `cd workspace && git init` and your notes have a history. The app
  seeds a `.gitignore` there that excludes `.cache/`, so only your PDFs and
  markdown get committed.
- **Obsidian** — open the workspace as a vault and edit the same files. The app
  re-reads a note from disk every time you move pages, so external edits win. A
  note file is plain markdown: entries are `## YYYY-MM-DD HH:MM:SS` sections,
  and anything above the first one still shows up as a single earlier note.
- **Claude Code** (or any agent) — point it at the folder and it can read your
  notes and the extracted text directly.

## What it does

**Page notes.** One markdown file per page, written as a transcript: press Add
(or ⌘↵) and what you wrote is appended as its own timestamped `##` section, so
notes on a page accumulate instead of replacing each other. Any single entry can
be edited afterwards. No autosave and no sync loop — the file changes when you
say so.

**AI page notes.** Press Generate and the model reads that one page plus your
note, then appends a timestamped section to `ai/page-NNN.md` with a summary and
feedback on what your note missed. Sections accumulate; nothing is overwritten.
The rendered page image always goes along with the text, so diagrams and
figures count too. The model is called only on that button — never on upload,
never in the background.

**Concept map.** Press Refresh on the map and the app reads the PDFs whose text
has changed and extracts the durable concepts, one markdown file each. A concept
appearing in several PDFs links them. The refresh reports how many LLM calls it
made, and unchanged PDFs are skipped for free.

## Configuration

**The settings page is the normal way in.** Open `/settings`, paste an API key,
and it takes effect on the next request — no restart. It is saved to
`~/.study-hack/config.json`, deliberately _outside_ your workspace, so a key
never lands in a folder you sync, commit, or open in Obsidian. The key is
write-only from the browser's side: the page can tell you one is saved and what
kind it is, and can remove it, but never reads it back.

**A key in the config file wins over `OPENAI_API_KEY` in the environment.** If
you save a key in settings and nothing seems to change, that is the direction
of the rule — not a bug. Clear the saved key to fall back to the environment.

`.env` still works for running from source:

| Variable              | Purpose                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| `STUDY_WORKSPACE`     | Where your PDFs and notes live. `./workspace` from source, `~/study-hack` under npx. |
| `OPENAI_API_KEY`      | Needed only for the AI features.                                                     |
| `OPENAI_MODEL`        | Default `gpt-5-mini`.                                                                |
| `OPENAI_VISION_MODEL` | For AI page notes, which include the page image. Default `gpt-5-mini`.               |
| `OPENAI_BASE_URL`     | Any OpenAI-compatible endpoint — a local model, a proxy.                             |

Point `OPENAI_BASE_URL` at something like Ollama or LM Studio and no data
leaves your machine.

## Known rough edges

The concept extractor is told to reuse existing names, but it can still produce
two files for one idea ("Backprop" and "Backpropagation"). They are markdown
files: merge them by hand — copy the `sources:` entries into one file and delete
the other. The map picks up the change on the next load.

Concept names that don't romanize (Korean, for instance) get a hashed filename
like `c-69a04286e3.md`. The readable name is in the file's `name:` frontmatter.

## Contributing

Read `AGENTS.md` first — it covers the layout, the commands, and the rules that
are not obvious from the code (what counts as user data, and when the app is
allowed to call a model). Then:

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Branch names are `<type>/<scope>-<kebab-desc>`; PR titles follow Conventional
Commits.

## License

MIT — see [LICENSE](./LICENSE).
