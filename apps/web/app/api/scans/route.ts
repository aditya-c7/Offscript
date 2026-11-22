import { NextResponse } from "next/server";
import { normalizeUrl } from "@offscript/shared";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { createWorkerJob } from "@/app/api/_lib/quota";
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
    // The worker owns the transactional inserts (site + scan) and returns the
    // generated scan id. The web app never opens a DB transaction here.
    const id = await createWorkerJob("/scans", {
      ownerId,
      url: normalized.href,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error: unknown) {
    logServerError("scan creation failed", error);
    return jsonError("Could not start the scan. Please try again.", 500);
  }
}
