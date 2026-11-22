import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, logServerError } from "@/app/api/_lib/http";
import { loadScanReport } from "@/app/api/_lib/get-scan-report";

const ParamsSchema = z.object({
  shareToken: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareToken: string }> },
) {
  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid share link.", 400);

    const report = await loadScanReport("shareToken", parsed.data.shareToken);
    if (!report) return jsonError("Report not found.", 404);
    return NextResponse.json({ scan: report });
  } catch (error: unknown) {
    logServerError("shared report lookup failed", error);
    return jsonError("Could not load this report.", 500);
  }
}
