import { NextResponse } from "next/server";
import { scans, sites } from "@offscript/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { getServerDb } from "@/lib/server-db";
import { createWorkerJob } from "@/app/api/_lib/quota";
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

    // Read-only ownership check; the worker creates the new scan transactionally.
    const rows = await db
      .select({ id: scans.id })
      .from(scans)
      .innerJoin(sites, eq(scans.siteId, sites.id))
      .where(
        and(eq(scans.id, parsed.data.id), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    if (rows.length === 0) return jsonError("Scan not found.", 404);

    const id = await createWorkerJob(`/scans/${parsed.data.id}/again`, {
      ownerId,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error: unknown) {
    logServerError("scan re-run failed", error);
    return jsonError("Could not start a new scan.", 500);
  }
}
