import { NextResponse } from "next/server";
import { analyses, runs, sites, steps } from "@offscript/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { getServerDb } from "@/lib/server-db";
import { jsonError, logServerError } from "@/app/api/_lib/http";
import { readObservation } from "@/app/api/_lib/analysis";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid analysis id.", 400);

    const ownerId = await getOwnerId();
    const db = getServerDb();
    const rows = await db
      .select({ analysis: analyses, site: sites })
      .from(analyses)
      .innerJoin(sites, eq(analyses.siteId, sites.id))
      .where(
        and(eq(analyses.id, parsed.data.id), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return jsonError("Analysis not found.", 404);

    const runRows = await db
      .select()
      .from(runs)
      .where(eq(runs.analysisId, row.analysis.id));

    const runPayloads = await Promise.all(
      runRows.map(async (run) => {
        const stepRows = await db
          .select()
          .from(steps)
          .where(eq(steps.runId, run.id))
          .orderBy(asc(steps.idx));

        const stepPayloads = await Promise.all(
          stepRows.map(async (step) => ({
            idx: step.idx,
            url: step.url,
            stateToken: step.stateToken,
            perceptionMode: step.perceptionMode,
            actionJson: step.actionJson,
            policyEventsJson: step.policyEventsJson,
            reasoningSummary: step.reasoningSummary,
            screenshotPath: step.screenshotPath,
            observationPath: step.observationPath,
            resultStatus: step.resultStatus,
            observation: await readObservation(run.id, step.observationPath),
          })),
        );

        return {
          id: run.id,
          taskKey: run.taskKey,
          taskText: run.taskText,
          successCriteria: run.successCriteria,
          profile: run.profile,
          status: run.status,
          verdict: run.verdict,
          answer: run.answer,
          modelId: run.modelId,
          steps: stepPayloads,
          verifierJson: run.verifierJson,
        };
      }),
    );

    // Credit settlement happens in the Node worker. This read-only endpoint
    // simply reports the stored value; it never mutates quota state.
    return NextResponse.json({
      analysis: {
        id: row.analysis.id,
        siteId: row.analysis.siteId,
        status: row.analysis.status,
        host: row.site.normalizedHost,
        creditConsumed: row.analysis.creditConsumed,
        artifactsExpiresAt:
          row.analysis.artifactsExpiresAt?.toISOString() ?? null,
        artifactsDeletedAt:
          row.analysis.artifactsDeletedAt?.toISOString() ?? null,
      },
      runs: runPayloads,
    });
  } catch (error: unknown) {
    logServerError("analysis lookup failed", error);
    return jsonError("Could not load this analysis.", 500);
  }
}
