import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { checks, scans, sites } from "@offscript/db";
import { getServerDb } from "@/lib/server-db";
import { jsonError, logServerError } from "@/app/api/_lib/http";
import { buildScanReportFromRows } from "@/app/api/_lib/get-scan-report";

const ParamsSchema = z.object({
  shareToken: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareToken: string }> },
) {
  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid share link.", 400);

    const db = getServerDb();
    const scanRows = await db
      .select({ scan: scans, site: sites })
      .from(scans)
      .innerJoin(sites, eq(scans.siteId, sites.id))
      .where(eq(scans.shareToken, parsed.data.shareToken))
      .limit(1);
    const scanRow = scanRows[0];
    if (!scanRow) return jsonError("Report not found.", 404);

    const checkRows = await db
      .select()
      .from(checks)
      .where(eq(checks.scanId, scanRow.scan.id));

    const report = buildScanReportFromRows({
      scan: scanRow.scan,
      site: scanRow.site,
      checks: checkRows,
    });
    if (!report) return jsonError("Report not found.", 404);
    return NextResponse.json({ scan: report });
  } catch (error: unknown) {
    logServerError("shared report lookup failed", error);
    return jsonError("Could not load this report.", 500);
  }
}
