import { NextResponse } from "next/server";
import { checks, scans, sites } from "@offscript/db";
import { desc, eq } from "drizzle-orm";
import { getOwnerId } from "@/lib/cookies";
import { getServerDb } from "@/lib/server-db";
import { buildScanReport } from "@/app/api/_lib/report";
import { jsonError, logServerError } from "@/app/api/_lib/http";

export async function GET() {
  try {
    const ownerId = await getOwnerId();
    const db = getServerDb();
    const ownerSites = await db
      .select()
      .from(sites)
      .where(eq(sites.ownerCookieId, ownerId));

    const siteSummaries = await Promise.all(
      ownerSites.map(async (site) => {
        const latestRows = await db
          .select()
          .from(scans)
          .where(eq(scans.siteId, site.id))
          .orderBy(desc(scans.createdAt))
          .limit(1);
        const latest = latestRows[0];
        if (!latest) {
          return {
            id: site.id,
            host: site.normalizedHost,
            url: site.url,
            detectedStack: site.detectedStack,
            lastScanAt: null,
            scoreOverall: null,
            find: 0,
            understand: 0,
            act: 0,
            latestVerdict: null,
            checksPassed: 0,
            checksTotal: 0,
            topFixes: [] as string[],
          };
        }

        const checkRows = await db
          .select()
          .from(checks)
          .where(eq(checks.scanId, latest.id));
        const report = buildScanReport(
          latest,
          {
            url: site.url,
            normalizedHost: site.normalizedHost,
            detectedStack: site.detectedStack,
          },
          checkRows,
        );

        const topFixes = report.defects.map((defect) => defect.title);

        return {
          id: site.id,
          host: report.host,
          url: report.submitted_url,
          detectedStack: report.detected_stack,
          lastScanAt: report.scanned_at,
          scoreOverall: report.scores.overall,
          find: report.scores.find,
          understand: report.scores.understand,
          act: report.scores.act,
          latestVerdict: report.verdict,
          checksPassed: report.checks_passed,
          checksTotal: report.checks_total,
          topFixes: Array.from(new Set(topFixes)).slice(0, 3),
        };
      }),
    );

    return NextResponse.json({ sites: siteSummaries });
  } catch (error: unknown) {
    logServerError("overview failed", error);
    return jsonError("Could not load your sites.", 500);
  }
}
