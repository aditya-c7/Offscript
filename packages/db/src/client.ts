import { neon } from "@neondatabase/serverless";
import { EnvSchema } from "@offscript/shared";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  drizzle as drizzleNeonHttp,
  type NeonHttpDatabase,
} from "drizzle-orm/neon-http";
import {
  drizzle as drizzleNodePostgres,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import * as schema from "./schema.js";

/**
 * Explicit driver selection. Defaulting to `node` keeps local development and
 * the local worker on node-postgres; web deployments on Cloudflare Workers set
 * `DB_DRIVER=neon-http` to use Neon's HTTP driver (no TCP pool).
 */
export const DbDriverSchema = z.enum(["node", "neon-http"]).default("node");
export type DbDriver = z.infer<typeof DbDriverSchema>;

/**
 * Narrow structural view of the drizzle handle exposing exactly the methods
 * the app uses. Borrowing the signatures from the node driver preserves
 * drizzle's typed `.returning(fields)` results; a union of the two concrete
 * driver types collapses those overloads to a 0-argument signature.
 */
export type Database = Pick<
  NodePgDatabase<typeof schema>,
  "select" | "insert" | "update" | "delete" | "transaction" | "execute"
>;

/** Runtime validation that a constructed driver handle satisfies `Database`. */
function isDatabase(value: unknown): value is Database {
  return (
    typeof value === "object" &&
    value !== null &&
    "select" in value &&
    typeof value.select === "function" &&
    "insert" in value &&
    typeof value.insert === "function" &&
    "update" in value &&
    typeof value.update === "function" &&
    "delete" in value &&
    typeof value.delete === "function" &&
    "transaction" in value &&
    typeof value.transaction === "function" &&
    "execute" in value &&
    typeof value.execute === "function"
  );
}

/** The transaction handle passed to {@link withTransaction} callbacks. */
export type DbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

let pool: Pool | undefined;
let nodeDatabase: NodePgDatabase<typeof schema> | undefined;
let neonDatabase: NeonHttpDatabase<typeof schema> | undefined;

/**
 * Validate the process environment. Kept lazy so importing this module does
 * not require a configured environment (unit tests import pure helpers).
 */
function getEnv() {
  return EnvSchema.parse(process.env);
}

/** Validate `DB_DRIVER` at the boundary; default to the local node driver. */
export function getDbDriver(): DbDriver {
  return DbDriverSchema.parse(process.env.DB_DRIVER);
}

/** Lazily create the node-postgres handle. Never connects at import time. */
function getNodeDb(): NodePgDatabase<typeof schema> {
  if (nodeDatabase === undefined) {
    if (pool === undefined) {
      const env = getEnv();
      pool = new Pool({ connectionString: env.DATABASE_URL });
    }
    nodeDatabase = drizzleNodePostgres(pool, { schema });
  }
  return nodeDatabase;
}

/** Lazily create the Neon HTTP handle (no Pool, no TCP connections). */
function getNeonHttpDb(): NeonHttpDatabase<typeof schema> {
  if (neonDatabase === undefined) {
    const env = getEnv();
    // `neon()` issues each query via HTTP using the platform `fetch`
    // (globalThis.fetch in Cloudflare Workers). There is no persistent
    // connection to pin or reuse.
    const client = neon(env.DATABASE_URL);
    neonDatabase = drizzleNeonHttp(client, { schema });
  }
  return neonDatabase;
}

/**
 * Return the lazily-created connection pool. Only valid for the node driver;
 * the neon-http driver has no pool by design.
 */
export function getPool(): Pool {
  if (getDbDriver() !== "node") {
    throw new Error(
      "getPool() is unavailable with DB_DRIVER=neon-http: Neon's HTTP driver " +
        "has no connection pool. Use getDb() instead.",
    );
  }
  if (pool === undefined) {
    const env = getEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

/** Return the lazily-created drizzle database handle for the active driver. */
export function getDb(): Database {
  const candidate: unknown =
    getDbDriver() === "node" ? getNodeDb() : getNeonHttpDb();
  if (!isDatabase(candidate)) {
    throw new Error("Database driver handle is missing required query methods");
  }
  return candidate;
}

/** Close the pool and reset the cached handles. Safe to call more than once. */
export async function closeDb(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
  }
  pool = undefined;
  nodeDatabase = undefined;
  neonDatabase = undefined;
}

/**
 * Run a callback inside a single drizzle (Postgres) transaction.
 *
 * drizzle's `neon-http` driver has no interactive transaction support
 * (`NeonHttpSession.transaction` throws), so this is only available with the
 * `node` driver. Fail loudly rather than silently weakening the guarantee.
 */
export async function withTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  if (getDbDriver() !== "node") {
    throw new Error(
      "withTransaction() is unavailable with DB_DRIVER=neon-http: " +
        "drizzle-orm/neon-http does not support interactive transactions. " +
        "Use the node driver for transactional code paths.",
    );
  }
  return getNodeDb().transaction(fn);
}
