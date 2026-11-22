import { NextResponse } from "next/server";
import { ARTIFACT_TTL_DAYS, TaskInputSchema } from "@offscript/shared";
import { analyses, runs, sites } from "@offscript/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { enqueueAnalysis } from "@/lib/queue";
import { getServerDb } from "@/lib/server-db";
import { getRemainingQuota } from "@/app/api/_lib/quota";
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

const PROFILES = ["text_structure", "visual_screen"] as const;

export async function POST(request: Request) {
  const limited = limitPost(request, "analyses");
  if (limited) return limited;

  const body = await parseJsonBody(request, AnalysisCreateSchema);
  if (!body.ok) return body.response;

  try {
    const ownerId = await getOwnerId();
    const db = getServerDb();

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

    const expiresAt = new Date(
      Date.now() + ARTIFACT_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    let analysisId = "";

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(analyses)
        .values({
          siteId: body.data.siteId,
          shareToken: randomUUID(),
          status: "queued",
          attestedAt: new Date(),
          artifactsExpiresAt: expiresAt,
        })
        .returning({ id: analyses.id });
      const analysis = inserted[0];
      if (!analysis) throw new Error("analysis insert failed");
      analysisId = analysis.id;

      const runValues = body.data.tasks.flatMap((task) =>
        PROFILES.map((profile) => ({
          analysisId: analysis.id,
          taskKey: task.task_key,
          profile,
          taskText: task.task_text,
          successCriteria: task.success_criteria,
          persona: task.persona ?? null,
          detailsJson: {
            lines: task.details_lines,
            importance_confidence: task.importance_confidence,
            why_it_matters: task.why_it_matters ?? null,
          },
          importanceConfidence: task.importance_confidence,
          whyItMatters: task.why_it_matters ?? null,
          status: "waiting",
          testId: randomUUID(),
        })),
      );
      await tx.insert(runs).values(runValues);
    });

    await enqueueAnalysis(analysisId);
    return NextResponse.json({ id: analysisId }, { status: 201 });
  } catch (error: unknown) {
    logServerError("analysis creation failed", error);
    return jsonError(
      "Could not start the agent analysis. Please try again.",
      500,
    );
  }
}
