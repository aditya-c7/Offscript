import { NextResponse } from "next/server";
import { PIPELINE_VERSION, RUBRIC_VERSION } from "@offscript/shared";
import { scans, sites } from "@offscript/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { enqueueScan } from "@/lib/queue";
import { getServerDb } from "@/lib/server-db";
import { jsonError, logServerError } from "@/app/api/_lib/http";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid scan id.", 400);

    const ownerId = await getOwnerId();
    const db = getServerDb();
    const rows = await db
      .select({ scan: scans, site: sites })
      .from(scans)
      .innerJoin(sites, eq(scans.siteId, sites.id))
      .where(
        and(eq(scans.id, parsed.data.id), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return jsonError("Scan not found.", 404);

    const created = await db
      .insert(scans)
      .values({
        siteId: row.site.id,
        shareToken: randomUUID(),
        status: "queued",
        rubricVersion: RUBRIC_VERSION,
        pipelineVersion: PIPELINE_VERSION,
      })
      .returning({ id: scans.id });
    const scan = created[0];
    if (!scan) return jsonError("Could not start a new scan.", 500);

    await enqueueScan(scan.id);
    return NextResponse.json({ id: scan.id }, { status: 201 });
  } catch (error: unknown) {
    logServerError("scan re-run failed", error);
    return jsonError("Could not start a new scan.", 500);
  }
}
