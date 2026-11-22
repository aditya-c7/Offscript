import { promises as fs } from "node:fs";
import path from "node:path";
import { ObservationV2Schema } from "@offscript/shared";
import { z } from "zod";
import { getStorageDir } from "@/lib/server-db";

const RunIdSchema = z.string().uuid();

/**
 * Stored artifact paths may be relative to the run directory or include the
 * storage prefix. Normalize them to a path inside `<storage>/<runId>`.
 */
export function relativeArtifactPath(
  runId: string,
  storedPath: string,
): string | null {
  const parts = storedPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0) return null;
  const runIndex = parts.lastIndexOf(runId);
  const relative = runIndex >= 0 ? parts.slice(runIndex + 1) : parts;
  if (relative.length === 0) return null;
  return relative.join("/");
}

/** Read a redacted observation/v2 artifact, validating it at the boundary. */
export async function readObservation(
  runId: string,
  relativePath: string | null,
): Promise<unknown | undefined> {
  if (!relativePath || relativePath.length === 0 || relativePath.length > 500) {
    return undefined;
  }
  if (!RunIdSchema.safeParse(runId).success) return undefined;

  const relative = relativeArtifactPath(runId, relativePath);
  if (!relative) return undefined;

  const base = path.resolve(getStorageDir(), runId);
  const full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) return undefined;

  try {
    const text = await fs.readFile(full, "utf8");
    const raw: unknown = JSON.parse(text);
    const parsed = ObservationV2Schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function isTerminalRunStatus(status: string): boolean {
  return (
    status === "done" ||
    status === "failed" ||
    status === "error" ||
    status === "complete"
  );
}
