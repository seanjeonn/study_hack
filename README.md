# study_hack

A local study app for reading PDFs. You keep a note on every page, ask for an AI
second read when you actually want one, and get a map of the concepts your
documents share.

Everything it produces is a plain file in a folder you choose. No database, no
account, no cloud — open the same notes in Obsidian, track them in git, point
Claude Code at them.

## Requirements

- **Node 22+** (see `.nvmrc`)
- **pnpm 10+**

That's the whole list. There is no database and no Docker.

## Getting started

```bash
git clone <this-repo>
cd study_hack
pnpm install
cp .env.example .env
pnpm dev
```

Open http://localhost:3000, add a PDF, and start reading.

Uploading blocks for a second or two while the text is extracted — that is
deliberate. Doing it up front means there is no background job, no processing
state, and no spinner to wait on later.

The AI features need an API key (below). Everything else — reading, paging,
extracted text, and your own notes — works without one.

## Where your data lives

Set `STUDY_WORKSPACE` to any folder. It defaults to `./workspace`, which is
gitignored.

```
workspace/
├── .gitignore                  excludes .cache/ — yours to edit
├── deep-learning-lecture-03/
│   ├── source.pdf              the PDF you uploaded
│   ├── notes/page-001.md       your notes — one file per page
│   ├── ai/page-014.md          AI notes, appended as timestamped sections
│   └── .cache/                 the app's own index — safe to delete
└── concepts/
    └── backpropagation.md      one concept, with frontmatter linking it to pages
```

**You own everything except `.cache/`.** That folder is derived data: delete it
and the app rebuilds it from `source.pdf` on the next request. Which also means
you can drop a PDF into a new folder by hand and the app will pick it up.

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

`.env`:

| Variable              | Purpose                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `STUDY_WORKSPACE`     | Where your PDFs and notes live. Default `./workspace`.                 |
| `OPENAI_API_KEY`      | Needed only for the AI features.                                       |
| `OPENAI_MODEL`        | Default `gpt-5-mini`.                                                  |
| `OPENAI_VISION_MODEL` | For AI page notes, which include the page image. Default `gpt-5-mini`. |
| `OPENAI_BASE_URL`     | Any OpenAI-compatible endpoint — a local model, a proxy.               |

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
