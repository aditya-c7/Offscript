import { EnvSchema } from "@offscript/shared";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  drizzle,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

/** The schema-aware drizzle database handle used throughout the package. */
export type Database = NodePgDatabase<typeof schema>;

/** The transaction handle passed to {@link withTransaction} callbacks. */
export type DbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

let pool: Pool | undefined;
let database: Database | undefined;

/**
 * Validate the process environment. Kept lazy so importing this module does
 * not require a configured environment (unit tests import pure helpers).
 */
function getEnv() {
  return EnvSchema.parse(process.env);
}

/** Return the lazily-created connection pool. Never connect at import time. */
export function getPool(): Pool {
  if (pool === undefined) {
    const env = getEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

/** Return the lazily-created drizzle database handle. */
export function getDb(): Database {
  if (database === undefined) {
    database = drizzle(getPool(), { schema });
  }
  return database;
}

/** Close the pool and reset the cached handles. Safe to call more than once. */
export async function closeDb(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
  }
  pool = undefined;
  database = undefined;
}

/** Run a callback inside a single drizzle (Postgres) transaction. */
export async function withTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(fn);
}
