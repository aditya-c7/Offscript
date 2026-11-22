import { Pool } from "pg";
import { z } from "zod";

const UuidSchema = z.string().uuid();
const RowIdSchema = z.object({ id: UuidSchema });
const CountSchema = z.number().int().nonnegative().nullable();

export interface CleanupResult {
  readonly ownerId: string;
  readonly deleted: Readonly<Record<string, number>>;
  readonly errors: readonly string[];
}

/**
 * Remove only rows created under this run's disposable owner prefix, plus the
 * pg-boss jobs keyed by the scan ids we generated. No schema is created,
 * altered, or migrated; every statement is parameterized.
 */
export async function cleanupRows(input: {
  databaseUrl: string;
  ownerId: string;
  scanIds: readonly string[];
}): Promise<CleanupResult> {
  const pool = new Pool({ connectionString: input.databaseUrl });
  const deleted: Record<string, number> = {};
  const errors: string[] = [];

  const runDelete = async (
    label: string,
    sql: string,
    params: readonly unknown[],
  ): Promise<void> => {
    try {
      const result = await pool.query(sql, [...params]);
      deleted[label] = CountSchema.parse(result.rowCount) ?? 0;
    } catch (error: unknown) {
      errors.push(
        `${label}: ${error instanceof Error ? error.name : "unknown_error"}`,
      );
    }
  };

  try {
    const sitesResult = await pool.query(
      "SELECT id FROM sites WHERE owner_cookie_id = $1",
      [input.ownerId],
    );
    const siteIds = z
      .array(RowIdSchema)
      .parse(sitesResult.rows.map((row: unknown) => RowIdSchema.parse(row)))
      .map((row) => row.id);
    deleted.sites_found = siteIds.length;

    if (siteIds.length > 0) {
      await runDelete(
        "steps",
        `DELETE FROM steps WHERE run_id IN (
           SELECT r.id FROM runs r
           JOIN analyses a ON a.id = r.analysis_id
           WHERE a.site_id = ANY($1::uuid[]))`,
        [siteIds],
      );
      await runDelete(
        "runs",
        `DELETE FROM runs WHERE analysis_id IN (
           SELECT id FROM analyses WHERE site_id = ANY($1::uuid[]))`,
        [siteIds],
      );
      await runDelete(
        "analyses",
        "DELETE FROM analyses WHERE site_id = ANY($1::uuid[])",
        [siteIds],
      );
      await runDelete(
        "checks",
        `DELETE FROM checks WHERE scan_id IN (
           SELECT id FROM scans WHERE site_id = ANY($1::uuid[]))`,
        [siteIds],
      );
      await runDelete(
        "scans",
        "DELETE FROM scans WHERE site_id = ANY($1::uuid[])",
        [siteIds],
      );
      await runDelete("sites", "DELETE FROM sites WHERE id = ANY($1::uuid[])", [
        siteIds,
      ]);
    }

    await runDelete(
      "browser_quotas",
      "DELETE FROM browser_quotas WHERE owner_cookie_id = $1",
      [input.ownerId],
    );

    if (input.scanIds.length > 0) {
      await runDelete(
        "pgboss_jobs",
        "DELETE FROM pgboss.job WHERE data->>'scanId' = ANY($1::text[])",
        [[...input.scanIds]],
      );
      await runDelete(
        "pgboss_archive",
        "DELETE FROM pgboss.archive WHERE data->>'scanId' = ANY($1::text[])",
        [[...input.scanIds]],
      );
    }
  } finally {
    await pool.end();
  }

  return { ownerId: input.ownerId, deleted, errors };
}
