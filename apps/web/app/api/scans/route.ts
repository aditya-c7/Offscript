import { NextResponse } from "next/server";
import {
  PIPELINE_VERSION,
  RUBRIC_VERSION,
  normalizeUrl,
} from "@offscript/shared";
import { scans, sites } from "@offscript/db";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { enqueueScan } from "@/lib/queue";
import { getServerDb } from "@/lib/server-db";
import {
  jsonError,
  limitPost,
  logServerError,
  parseJsonBody,
} from "@/app/api/_lib/http";

const ScanCreateSchema = z.object({
  url: z.string().min(1).max(2048),
});

export async function POST(request: Request) {
  const limited = limitPost(request, "scans");
  if (limited) return limited;

  const body = await parseJsonBody(request, ScanCreateSchema);
  if (!body.ok) return body.response;

  let normalized;
  try {
    normalized = normalizeUrl(body.data.url);
  } catch (error: unknown) {
    const message =
      error instanceof Error &&
      error.message.length > 0 &&
      error.message.length < 200
        ? error.message
        : "That does not look like a valid web address.";
    return jsonError(message, 400);
  }

  try {
    const ownerId = await getOwnerId();
    const db = getServerDb();
    let scanId = "";

    await db.transaction(async (tx) => {
      const insertedSites = await tx
        .insert(sites)
        .values({
          ownerCookieId: ownerId,
          url: normalized.href,
          normalizedHost: normalized.host,
          detectedStack: "generic",
        })
        .returning({ id: sites.id });
      const site = insertedSites[0];
      if (!site) throw new Error("site insert failed");

      const insertedScans = await tx
        .insert(scans)
        .values({
          siteId: site.id,
          shareToken: randomUUID(),
          status: "queued",
          rubricVersion: RUBRIC_VERSION,
          pipelineVersion: PIPELINE_VERSION,
        })
        .returning({ id: scans.id });
      const scan = insertedScans[0];
      if (!scan) throw new Error("scan insert failed");
      scanId = scan.id;
    });

    await enqueueScan(scanId);
    return NextResponse.json({ id: scanId }, { status: 201 });
  } catch (error: unknown) {
    logServerError("scan creation failed", error);
    return jsonError("Could not start the scan. Please try again.", 500);
  }
}
