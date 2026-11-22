import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { jsonError, logServerError } from "@/app/api/_lib/http";
import { loadScanReport } from "@/app/api/_lib/get-scan-report";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid scan id.", 400);

    const ownerId = await getOwnerId();
    const report = await loadScanReport("id", parsed.data.id, ownerId);
    if (!report) return jsonError("Scan not found.", 404);
    return NextResponse.json({ scan: report });
  } catch (error: unknown) {
    logServerError("scan lookup failed", error);
    return jsonError("Could not load this scan.", 500);
  }
}
