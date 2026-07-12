import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * `bytea` is not a built-in column type in this drizzle-orm version, so we
 * define it via customType. node-postgres round-trips bytea as a Buffer, which
 * is exactly what `pdf-to-img` consumes — no conversion needed.
 */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Uploaded PDFs. The original bytes live in `bytes`; page PNGs are rendered on
 * demand and cached in process memory (not persisted). `status` tracks the
 * processing stage for later slices; `user_id` is a nullable hedge for the
 * eventual multi-user slice so adding ownership later is not a destructive
 * migration.
 */
export const pdf = pgTable("pdf", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  pageCount: integer("page_count").notNull(),
  bytes: bytea("bytes").notNull(),
  status: text("status").notNull().default("uploaded"),
  userId: uuid("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/**
 * Per-page extracted text. Populated by the background extraction job after
 * upload. `has_text` is false when a page has almost no extractable text
 * (scan/image slide = OCR candidate). One row per (pdf, page).
 */
export const pdfPage = pgTable(
  "pdf_page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pdfId: uuid("pdf_id")
      .notNull()
      .references(() => pdf.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    extractedText: text("extracted_text").notNull(),
    hasText: boolean("has_text").notNull(),
  },
  (table) => [unique().on(table.pdfId, table.pageNumber)],
);

/**
 * Generated multiple-choice quiz questions for a PDF. `type` is always "mcq"
 * in v1 (the column exists for future question types); `difficulty` is fixed
 * "medium" for now (also reserved for later). `sourcePageIds` are the 1-indexed
 * pages the question/answer is grounded in — the citation-accuracy signal,
 * same idea as `pdfPage` citations in `askPdf`. `user_id` is a nullable hedge
 * for the eventual multi-user slice, like `pdf.userId`.
 */
export const quizQuestion = pgTable("quiz_question", {
  id: uuid("id").primaryKey().defaultRandom(),
  pdfId: uuid("pdf_id")
    .notNull()
    .references(() => pdf.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  question: text("question").notNull(),
  choices: jsonb("choices").$type<string[]>().notNull(),
  answerIndex: integer("answer_index").notNull(),
  explanation: text("explanation").notNull(),
  sourcePageIds: integer("source_page_ids").array().notNull(),
  difficulty: text("difficulty").notNull(),
  userId: uuid("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/**
 * A graded attempt at a single quiz question (slice 5 — server-side
 * grading). One row per submission; a question can be attempted more than
 * once (e.g. "retry wrong answers"), so the latest row per `quizQuestionId`
 * is the current graded state. `user_id` is a nullable hedge for the eventual
 * multi-user slice, like `quizQuestion.userId`.
 */
export const quizAttempt = pgTable("quiz_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  quizQuestionId: uuid("quiz_question_id")
    .notNull()
    .references(() => quizQuestion.id, { onDelete: "cascade" }),
  userAnswer: integer("user_answer").notNull(),
  isCorrect: boolean("is_correct").notNull(),
  userId: uuid("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

/**
 * better-auth tables (slice 8). Hand-written to match the better-auth CLI's
 * generated Drizzle schema (text ids, singular table names). Do not rename
 * columns — the drizzle adapter maps them by these exact names.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/**
 * A user-authored study note (slice 6). The roadmap named a `page_id` FK, but
 * the app is page-number-centric throughout (viewer, citations, quiz
 * `sourcePageIds`), so we store the page number directly instead of a page
 * row reference. `quiz_question_id` is unused in v1 — a hedge for attaching a
 * memo to a specific question later. `ai_summary` is unused in v1 — a hedge
 * for AI memo summarization later. `user_id` is a nullable hedge for the
 * eventual multi-user slice, like `pdf.userId`.
 */
export const memo = pgTable("memo", {
  id: uuid("id").primaryKey().defaultRandom(),
  pdfId: uuid("pdf_id")
    .notNull()
    .references(() => pdf.id, { onDelete: "cascade" }),
  pageNumber: integer("page_number"),
  quizQuestionId: uuid("quiz_question_id").references(() => quizQuestion.id, {
    onDelete: "cascade",
  }),
  content: text("content").notNull(),
  aiSummary: text("ai_summary"),
  userId: uuid("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
