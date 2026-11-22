import { NextResponse } from "next/server";
import {
  ARTIFACT_TTL_DAYS,
  ProfileSchema,
  TaskKeySchema,
} from "@offscript/shared";
import { analyses, runs, sites } from "@offscript/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { enqueueAnalysis } from "@/lib/queue";
import { getServerDb } from "@/lib/server-db";
import { getRemainingQuota } from "@/app/api/_lib/quota";
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
    const rows = await db
      .select({ analysis: analyses })
      .from(analyses)
      .innerJoin(sites, eq(analyses.siteId, sites.id))
      .where(
        and(eq(analyses.id, parsed.data.id), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    const original = rows[0];
    if (!original) return jsonError("Analysis not found.", 404);

    const originalRuns = await db
      .select()
      .from(runs)
      .where(eq(runs.analysisId, parsed.data.id));
    if (originalRuns.length === 0) return jsonError("Analysis not found.", 404);

    const remaining = await getRemainingQuota(ownerId);
    if (remaining < 1) {
      return jsonError("You have no agent analyses left.", 403);
    }

    const expiresAt = new Date(
      Date.now() + ARTIFACT_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    let analysisId = "";

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(analyses)
        .values({
          siteId: original.analysis.siteId,
          shareToken: randomUUID(),
          status: "queued",
          attestedAt: new Date(),
          artifactsExpiresAt: expiresAt,
        })
        .returning({ id: analyses.id });
      const analysis = inserted[0];
      if (!analysis) throw new Error("analysis insert failed");
      analysisId = analysis.id;

      await tx.insert(runs).values(
        originalRuns.map((run) => {
          const taskKey = TaskKeySchema.safeParse(run.taskKey);
          const profile = ProfileSchema.safeParse(run.profile);
          return {
            analysisId: analysis.id,
            taskKey: taskKey.success ? taskKey.data : "custom",
            profile: profile.success ? profile.data : "text_structure",
            taskText: run.taskText,
            successCriteria: run.successCriteria,
            persona: run.persona,
            detailsJson: run.detailsJson,
            importanceConfidence: run.importanceConfidence,
            whyItMatters: run.whyItMatters,
            status: "waiting",
            testId: randomUUID(),
          };
        }),
      );
    });

    await enqueueAnalysis(analysisId);
    return NextResponse.json({ id: analysisId }, { status: 201 });
  } catch (error: unknown) {
    logServerError("analysis re-run failed", error);
    return jsonError("Could not start the analysis again.", 500);
  }
}
