import { checks, scans, sites } from "@offscript/db";
import { eq, type SQL } from "drizzle-orm";
import type { ScanReport } from "@offscript/shared";
import { getServerDb } from "@/lib/server-db";
import { buildScanReport } from "@/app/api/_lib/report";

/**
 * Load a report either by internal scan id or by public share token.
 * When ownerId is supplied, the site must belong to that owner.
 */
export async function loadScanReport(
  by: "id" | "shareToken",
  value: string,
  ownerId?: string,
): Promise<ScanReport | null> {
  const db = getServerDb();
  const clause: SQL =
    by === "id" ? eq(scans.id, value) : eq(scans.shareToken, value);

  const rows = await db
    .select({ scan: scans, site: sites })
    .from(scans)
    .innerJoin(sites, eq(scans.siteId, sites.id))
    .where(clause)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (ownerId && row.site.ownerCookieId !== ownerId) return null;

  const checkRows = await db
    .select()
    .from(checks)
    .where(eq(checks.scanId, row.scan.id));

  return buildScanReport(row.scan, row.site, checkRows);
}
