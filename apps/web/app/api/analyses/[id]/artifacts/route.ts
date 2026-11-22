import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { analyses, markArtifactsDeleted, runs, sites } from "@offscript/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { getServerDb, getStorageDir } from "@/lib/server-db";
import { jsonError, logServerError } from "@/app/api/_lib/http";

const ParamsSchema = z.object({ id: z.string().uuid() });
const RunIdSchema = z.string().uuid();

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid analysis id.", 400);

    const ownerId = await getOwnerId();
    const db = getServerDb();
    const owned = await db
      .select({ id: analyses.id })
      .from(analyses)
      .innerJoin(sites, eq(analyses.siteId, sites.id))
      .where(
        and(eq(analyses.id, parsed.data.id), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    if (owned.length === 0) return jsonError("Analysis not found.", 404);

    const runRows = await db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.analysisId, parsed.data.id));

    await markArtifactsDeleted(parsed.data.id);

    await Promise.all(
      runRows.flatMap((run) => {
        if (!RunIdSchema.safeParse(run.id).success) return [];
        const dir = path.resolve(getStorageDir(), run.id);
        return [
          fs.rm(dir, { recursive: true, force: true }).catch(() => undefined),
        ];
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    logServerError("artifact deletion failed", error);
    return jsonError("Could not delete screenshots and readings.", 500);
  }
}
