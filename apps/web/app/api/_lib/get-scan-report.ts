import type { ScanReport } from "@offscript/shared";
import {
  buildScanReport,
  type ReportCheckRow,
  type ReportScanRow,
  type ReportSiteRow,
} from "./report";

/**
 * A single read-only query result, supplied by the caller.
 *
 * This module intentionally has no database imports: web runs on Cloudflare
 * Workers with the neon-http driver, so all persistence I/O (and any Node-only
 * drivers) must stay in the route handlers. The helpers here only turn plain
 * rows into a report.
 */
export interface ScanReportQueryRow {
  scan: ReportScanRow;
  site: ReportSiteRow & { ownerCookieId?: string | null };
  checks: ReportCheckRow[];
}

/**
 * Build a report from already-loaded, read-only rows. No clients, no I/O, no
 * transactions. Accepts either one row or a `.limit(1)` result array.
 */
export function buildScanReportFromRows(
  rows: ScanReportQueryRow | ScanReportQueryRow[] | null | undefined,
  ownerId?: string,
): ScanReport | null {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  if (ownerId && row.site.ownerCookieId !== ownerId) return null;
  return buildScanReport(row.scan, row.site, row.checks);
}

/** Alias for callers that prefer a shorter name. */
export const reportFromRows = buildScanReportFromRows;

/**
 * Source-compatible facade for older callers.
 *
 * The database read is no longer performed here. Callers should load the scan,
 * site and check rows with their own read-only queries and pass them in via
 * `buildScanReportFromRows` (or as the optional `rows` argument below). With no
 * rows supplied on a Workers runtime, there is nothing to build and `null` is
 * returned rather than creating a server-side DB client.
 */
export async function loadScanReport(
  by: "id" | "shareToken",
  value: string,
  ownerId?: string,
  rows?: ScanReportQueryRow | ScanReportQueryRow[] | null,
): Promise<ScanReport | null> {
  void by;
  void value;
  return buildScanReportFromRows(rows ?? null, ownerId);
}
