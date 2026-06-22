import { sql } from "drizzle-orm";
import { customType, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
