import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { checks, scans, sites } from "@offscript/db";
import { getOwnerId } from "@/lib/cookies";
import { getServerDb } from "@/lib/server-db";
import { jsonError, logServerError } from "@/app/api/_lib/http";
import { buildScanReportFromRows } from "@/app/api/_lib/get-scan-report";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid scan id.", 400);

    const ownerId = await getOwnerId();
    const db = getServerDb();
    const scanRows = await db
      .select({ scan: scans, site: sites })
      .from(scans)
      .innerJoin(sites, eq(scans.siteId, sites.id))
      .where(
        and(eq(scans.id, parsed.data.id), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    const scanRow = scanRows[0];
    if (!scanRow) return jsonError("Scan not found.", 404);

    const checkRows = await db
      .select()
      .from(checks)
      .where(eq(checks.scanId, scanRow.scan.id));

    const report = buildScanReportFromRows(
      {
        scan: scanRow.scan,
        site: scanRow.site,
        checks: checkRows,
      },
      ownerId,
    );
    if (!report) return jsonError("Scan not found.", 404);
    return NextResponse.json({ scan: report });
  } catch (error: unknown) {
    logServerError("scan lookup failed", error);
    return jsonError("Could not load this scan.", 500);
  }
}
