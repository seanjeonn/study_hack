import { z } from "zod";

/**
 * Wire schemas + inferred types — the single source of truth for every HTTP
 * boundary in the app. Safe to import from client components: this module is
 * pure zod, with no node-only code (that lives in `lib/server/`).
 */
/**
 * A PDF in the workspace. `id` is the directory name (a slug derived from the
 * filename) and doubles as the URL segment. The page images themselves are
 * served as binary PNGs from `/pages/:n` (1-indexed), not in this payload.
 */
export const PdfSummarySchema = z.object({
  id: z.string(),
  filename: z.string(),
  pageCount: z.number().int().positive(),
  createdAt: z.string(),
  /** The subject this PDF is grouped under. Absent means ungrouped. */
  subject: z.string().optional(),
});

export type PdfSummary = z.infer<typeof PdfSummarySchema>;

/**
 * A subject is free text the user types (Korean included), never a slug: it
 * only ever travels as a query parameter, and matching is exact after a trim.
 * The empty string is valid — it is how a PDF is put back in Ungrouped.
 */
export const SubjectSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^[^\r\n]*$/);

/** Request body for `PUT /api/pdfs/[id]/subject` — an empty subject ungroups. */
export const SubjectUpdateRequestSchema = z.object({
  subject: SubjectSchema,
});

export type SubjectUpdateRequest = z.infer<typeof SubjectUpdateRequestSchema>;

/** Response for `GET /api/pdfs` — every PDF in the workspace, newest first. */
export const PdfListResponseSchema = z.object({
  pdfs: z.array(PdfSummarySchema),
});

export type PdfListResponse = z.infer<typeof PdfListResponseSchema>;

/** Response for `GET /api/pdfs/[id]/pages/[n]/text` — a single page's extracted text. */
export const PageTextResponseSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  // false when the page has almost no extractable text (scan/image = OCR candidate).
  hasText: z.boolean(),
});

export type PageTextResponse = z.infer<typeof PageTextResponseSchema>;

/**
 * Data-driven recommendation derived from extraction metrics:
 * - `ok`: text coverage looks usable.
 * - `consider_ocr`: too many pages have no text (likely scanned/image PDF).
 * - `consider_llm_or_ocr`: text exists but is heavily garbled (encoding/font
 *   mapping failure), so OCR or an LLM-based extraction pass is worth considering.
 */
export const ExtractionRecommendationSchema = z.enum(["ok", "consider_ocr", "consider_llm_or_ocr"]);

export type ExtractionRecommendation = z.infer<typeof ExtractionRecommendationSchema>;

/**
 * Response for `GET /api/pdfs/[id]` — an objective quality gauge for
 * extracted text so the OCR-vs-LLM decision is made from data, not vibes. Ratios
 * are in 0..1. Semantic correctness is NOT captured here (needs human review).
 */
export const ExtractionReportSchema = z.object({
  pageCount: z.number().int().nonnegative(),
  textPages: z.number().int().nonnegative(),
  emptyPages: z.number().int().nonnegative(),
  hasTextRatio: z.number().min(0).max(1),
  totalChars: z.number().int().nonnegative(),
  avgCharsPerTextPage: z.number().nonnegative(),
  // "Suspicious" chars are corruption markers (controls, broken-CID symbols,
  // replacement/Specials). suspectPages = pages whose suspicious ratio is high
  // enough to look genuinely garbled (localized garble that a global ratio
  // would dilute away).
  suspiciousChars: z.number().int().nonnegative(),
  suspiciousRatio: z.number().min(0).max(1),
  suspectPages: z.number().int().nonnegative(),
  recommendation: ExtractionRecommendationSchema,
});

export type ExtractionReport = z.infer<typeof ExtractionReportSchema>;

/**
 * One entry in a page's note. `id` is the entry's timestamp heading, which is
 * also its identity on disk. An empty `id` is the preamble: text that sits
 * above the first timestamp heading, which is how a hand-written or older flat
 * note file reads.
 */
export const NoteEntrySchema = z.object({
  id: z.string(),
  content: z.string(),
});

export type NoteEntry = z.infer<typeof NoteEntrySchema>;

/**
 * Response for the page-note routes — the page's note as its accumulated
 * entries, oldest first. An empty array means the page has no note file yet.
 */
export const PageNoteResponseSchema = z.object({
  pageNumber: z.number().int().positive(),
  entries: z.array(NoteEntrySchema),
});

export type PageNoteResponse = z.infer<typeof PageNoteResponseSchema>;

/** Request body for `POST /api/pdfs/[id]/pages/[n]/note` — append one entry. */
export const NoteEntryCreateRequestSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
});

export type NoteEntryCreateRequest = z.infer<typeof NoteEntryCreateRequestSchema>;

/** Request body for `PUT /api/pdfs/[id]/pages/[n]/note` — edit one entry in place. */
export const NoteEntryUpdateRequestSchema = z.object({
  entryId: z.string(),
  content: z.string().trim().min(1).max(100_000),
});

export type NoteEntryUpdateRequest = z.infer<typeof NoteEntryUpdateRequestSchema>;

/** Response for `GET /api/pdfs/[id]` — a PDF's summary plus its extraction report. */
export const PdfDetailResponseSchema = z.object({
  summary: PdfSummarySchema,
  extraction: ExtractionReportSchema,
});

export type PdfDetailResponse = z.infer<typeof PdfDetailResponseSchema>;

/**
 * Response for the AI page-note routes — the whole accumulated markdown file
 * for one page. Sections are append-only, so this grows by one `##` block per
 * generation and older sections are never rewritten.
 */
export const AiNoteResponseSchema = z.object({
  pageNumber: z.number().int().positive(),
  content: z.string(),
});

export type AiNoteResponse = z.infer<typeof AiNoteResponseSchema>;

/** A place a concept appears: a PDF id and the 1-indexed pages it shows up on. */
export const ConceptSourceSchema = z.object({
  pdf: z.string(),
  pages: z.array(z.number().int().positive()),
});

export type ConceptSource = z.infer<typeof ConceptSourceSchema>;

/** Response for `GET /api/concepts/[slug]` — one concept, body included. */
export const ConceptResponseSchema = z.object({
  slug: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  sources: z.array(ConceptSourceSchema),
  related: z.array(z.string()),
  updated: z.string(),
  body: z.string(),
});

export type ConceptResponse = z.infer<typeof ConceptResponseSchema>;

/**
 * Response for `GET /api/concepts/graph`. Edges are undirected pairs, already
 * deduped and stripped of any that point at a concept file that no longer
 * exists.
 */
export const ConceptGraphResponseSchema = z.object({
  nodes: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      /** How many distinct PDFs mention the concept — its cross-PDF weight. */
      pdfCount: z.number().int().nonnegative(),
    }),
  ),
  edges: z.array(z.object({ source: z.string(), target: z.string() })),
});

export type ConceptGraphResponse = z.infer<typeof ConceptGraphResponseSchema>;

/**
 * An API key as typed into the settings form. Trimmed because pasting one out
 * of a dashboard picks up whitespace; whitespace *inside* is always a mistake.
 * The empty string is valid — it is how a saved key is removed.
 */
export const ApiKeySchema = z.string().trim().max(500).regex(/^\S*$/);

/**
 * `~/.study-hack/config.json` — the app's own settings, deliberately outside
 * the workspace so an API key never lands in a folder the user syncs or
 * commits. A user can hand-edit or corrupt this file, so every read
 * `safeParse`s with these defaults as the fallback.
 */
export const AppConfigSchema = z.object({
  apiKey: z.string().optional(),
  /** Off unless the user turned it on. Never inferred, never defaulted true. */
  telemetryOptIn: z.boolean().default(false),
  /** Random per-install id, minted on first use. Not tied to any identity. */
  installId: z.string().optional(),
  /** Latch so the one-off install event is sent at most once. */
  installEventSent: z.boolean().default(false),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const KeyKindSchema = z.enum(["openai", "beta", "other"]);

/**
 * Response for `GET /api/settings` — a *masked* view. The key itself never
 * travels back to the browser: the form can tell you a key is saved and what
 * kind it is, and that is all it needs to render.
 */
export const SettingsResponseSchema = z.object({
  hasKey: z.boolean(),
  keyKind: KeyKindSchema.nullable(),
  telemetryOptIn: z.boolean(),
});

export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

/** Request body for `PUT /api/settings`. Omitted fields are left alone. */
export const SettingsUpdateRequestSchema = z.object({
  /** An empty string removes the saved key. */
  apiKey: ApiKeySchema.optional(),
  telemetryOptIn: z.boolean().optional(),
});

export type SettingsUpdateRequest = z.infer<typeof SettingsUpdateRequestSchema>;

/**
 * Request body for `POST /api/feedback/fakedoor` — the pricing answer.
 *
 * `dismissed` is a first-class answer: closing the dialog is a real response
 * to "would you pay", and dropping it would bias the sample toward people
 * willing to click something.
 *
 * This travels regardless of the telemetry opt-in. Answering the question *is*
 * the consent — the dialog asks one thing and sends exactly that one thing.
 */
export const FakeDoorAnswerSchema = z.object({
  answer: z.enum(["yes", "no", "not_sure", "dismissed"]),
  installId: z.string().min(1).max(100),
  price: z.string().max(50).optional(),
});

export type FakeDoorAnswer = z.infer<typeof FakeDoorAnswerSchema>;

/**
 * Response for `POST /api/concepts/refresh`. `llmCalls` is reported so the
 * cost of a refresh is visible rather than hidden.
 */
export const ConceptRefreshResponseSchema = z.object({
  scannedPdfs: z.number().int().nonnegative(),
  skippedPdfs: z.number().int().nonnegative(),
  llmCalls: z.number().int().nonnegative(),
  conceptsCreated: z.number().int().nonnegative(),
  conceptsUpdated: z.number().int().nonnegative(),
});

export type ConceptRefreshResponse = z.infer<typeof ConceptRefreshResponseSchema>;

/**
 * The signed-in Google identity, as stored in `~/.study-hack/session.json`.
 *
 * Only what the UI shows and the proxy exchange needs. No tokens: the id_token
 * is spent the moment it arrives and never written down, and there is no
 * refresh token — a proxy outage is recovered by signing in again, which is
 * idempotent on the proxy's side.
 *
 * Hand-editable like every other file the app owns, so every read `safeParse`s
 * with "signed out" as the fallback.
 */
export const SessionSchema = z.object({
  /** Google's stable account id. The proxy keys an account on this, not the email. */
  sub: z.string().min(1),
  email: z.string().min(1),
  name: z.string().optional(),
  picture: z.string().optional(),
  signedInAt: z.string(),
});

export type Session = z.infer<typeof SessionSchema>;

/**
 * Response for `GET /api/auth/session` — what the login page polls.
 *
 * Deliberately narrower than the stored session: the picture URL and the
 * Google `sub` have no business in a payload whose only job is to answer "can
 * I navigate to the app yet".
 */
export const SessionResponseSchema = z.object({
  signedIn: z.boolean(),
  email: z.string().optional(),
  name: z.string().optional(),
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/**
 * The one in-flight sign-in, as stored in `~/.study-hack/pending-auth.json`.
 *
 * A file rather than an in-memory Map because `next start` and the CLI are
 * separate processes in some launch paths, and a single slot rather than a
 * table because a person signs in once at a time — a second attempt should
 * replace the first, not accumulate.
 *
 * `redirectUri` is stored rather than rebuilt: Google compares the value sent
 * to `/authorize` against the one sent to the token endpoint byte for byte, and
 * `localhost` versus `127.0.0.1` — or a different port on a retry — is exactly
 * how that mismatch happens.
 */
export const PendingAuthSchema = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  redirectUri: z.string().min(1),
  createdAt: z.number(),
});

export type PendingAuth = z.infer<typeof PendingAuthSchema>;
