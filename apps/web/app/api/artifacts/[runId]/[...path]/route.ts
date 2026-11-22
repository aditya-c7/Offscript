import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { analyses, runs, sites } from "@offscript/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getOwnerId } from "@/lib/cookies";
import { getServerDb, getStorageDir } from "@/lib/server-db";
import { jsonError, logServerError } from "@/app/api/_lib/http";

const ParamsSchema = z.object({
  runId: z.string().uuid(),
  path: z
    .array(
      z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9._-]+$/)
        .refine((segment) => segment !== "." && segment !== "..", {
          message: "invalid path segment",
        }),
    )
    .min(1)
    .max(8),
});

function contentTypeFor(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".json") return "application/json";
  return "application/octet-stream";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; path: string[] }> },
) {
  try {
    const parsed = ParamsSchema.safeParse(await params);
    if (!parsed.success) return jsonError("Invalid artifact path.", 400);

    const ownerId = await getOwnerId();
    const db = getServerDb();
    const owned = await db
      .select({ id: runs.id })
      .from(runs)
      .innerJoin(analyses, eq(runs.analysisId, analyses.id))
      .innerJoin(sites, eq(analyses.siteId, sites.id))
      .where(
        and(eq(runs.id, parsed.data.runId), eq(sites.ownerCookieId, ownerId)),
      )
      .limit(1);
    if (owned.length === 0) return jsonError("Artifact not found.", 404);

    const base = path.resolve(getStorageDir(), parsed.data.runId);
    const full = path.resolve(base, ...parsed.data.path);
    if (!full.startsWith(base + path.sep))
      return jsonError("Artifact not found.", 404);

    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const file = await fs.readFile(full);
      bytes = new Uint8Array(file.byteLength);
      bytes.set(file);
    } catch {
      return jsonError("Artifact not found.", 404);
    }

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentTypeFor(full),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    logServerError("artifact read failed", error);
    return jsonError("Could not read this artifact.", 500);
  }
}
