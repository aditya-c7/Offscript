import { NextResponse } from "next/server";
import { analyses, sites } from "@offscript/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { getServerDb } from "@/lib/server-db";
import { createWorkerJob, getRemainingQuota } from "@/app/api/_lib/quota";
import { jsonError, limitPost, logServerError } from "@/app/api/_lib/http";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = limitPost(request, "analyses-again");
  if (limited) return limited;

  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid analysis id.", 400);

    const ownerId = await getOwnerId();
    const db = getServerDb();

    // Read-only ownership check; the worker recreates the analysis and its
    // runs transactionally and returns the new id.
    const rows = await db
      .select({ id: analyses.id })
      .from(analyses)
      .innerJoin(sites, eq(analyses.siteId, sites.id))
      .where(
        and(eq(analyses.id, parsed.data.id), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    if (rows.length === 0) return jsonError("Analysis not found.", 404);

    const remaining = await getRemainingQuota(ownerId);
    if (remaining < 1) {
      return jsonError("You have no agent analyses left.", 403);
    }

    const id = await createWorkerJob(`/analyses/${parsed.data.id}/again`, {
      ownerId,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error: unknown) {
    logServerError("analysis re-run failed", error);
    return jsonError("Could not start the analysis again.", 500);
  }
}
