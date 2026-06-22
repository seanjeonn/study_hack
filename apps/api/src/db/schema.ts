import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
 * Per-page extracted content for a PDF. `text_layer_text` is the raw pdfjs
 * output (free, accurate for selectable text); `vision_text` is the Sonnet 4.6
 * transcription that recovers image-locked content (diagrams, equations, code);
 * `content` is the merged field downstream slices consume (vision, falling back
 * to the text layer). Keeping the three separate lets `content` be re-derived
 * without re-calling the LLM. Unique `(pdf_id, page_number)` makes extraction
 * idempotent via upsert.
 */
export const pdfPage = pgTable(
  "pdf_page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pdfId: uuid("pdf_id")
      .notNull()
      .references(() => pdf.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    textLayerText: text("text_layer_text").notNull().default(""),
    charCount: integer("char_count").notNull(),
    hasText: boolean("has_text").notNull(),
    visionUsed: boolean("vision_used").notNull().default(false),
    visionText: text("vision_text"),
    content: text("content").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [uniqueIndex("pdf_page_pdf_id_page_number_idx").on(table.pdfId, table.pageNumber)],
);
