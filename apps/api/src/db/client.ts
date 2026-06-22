import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

// `pg` is a CommonJS module; its named exports are not reliably accessible via
// ESM named imports, so destructure from the default import.
const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set — see apps/api/.env.example");
}

const pool = new Pool({ connectionString: databaseUrl });

export const db = drizzle({ client: pool, schema });
