import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/cookies";
import { getRemainingQuota } from "@/app/api/_lib/quota";
import { jsonError, logServerError } from "@/app/api/_lib/http";

export async function GET() {
  try {
    const ownerId = await getOwnerId();
    const remaining = await getRemainingQuota(ownerId);
    return NextResponse.json({ remaining });
  } catch (error: unknown) {
    logServerError("quota lookup failed", error);
    return jsonError("Could not load your remaining analyses.", 500);
  }
}
