import { NextResponse } from "next/server";
import { TaskInputSchema } from "@offscript/shared";
import { sites } from "@offscript/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { getServerDb } from "@/lib/server-db";
import { createWorkerJob, getRemainingQuota } from "@/app/api/_lib/quota";
import {
  jsonError,
  limitPost,
  logServerError,
  parseJsonBody,
} from "@/app/api/_lib/http";

const AnalysisCreateSchema = z.object({
  siteId: z.string().uuid(),
  tasks: z.array(TaskInputSchema).min(1).max(12),
});

export async function POST(request: Request) {
  const limited = limitPost(request, "analyses");
  if (limited) return limited;

  const body = await parseJsonBody(request, AnalysisCreateSchema);
  if (!body.ok) return body.response;

  try {
    const ownerId = await getOwnerId();
    const db = getServerDb();

    // Read-only ownership check; the worker performs the transactional write.
    const ownedSites = await db
      .select({ id: sites.id })
      .from(sites)
      .where(
        and(eq(sites.id, body.data.siteId), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    if (ownedSites.length === 0) return jsonError("Site not found.", 404);

    const remaining = await getRemainingQuota(ownerId);
    if (remaining < 1) {
      return jsonError(
        "You have no agent analyses left. Delete old artifacts or try again later.",
        403,
      );
    }

    const id = await createWorkerJob("/analyses", {
      ownerId,
      siteId: body.data.siteId,
      tasks: body.data.tasks,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error: unknown) {
    logServerError("analysis creation failed", error);
    return jsonError(
      "Could not start the agent analysis. Please try again.",
      500,
    );
  }
}
