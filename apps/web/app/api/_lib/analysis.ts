import { ObservationV2Schema } from "@offscript/shared";
import { z } from "zod";

const RunIdSchema = z.string().uuid();
const RelativePathSchema = z.string().min(1).max(500);
const ArtifactKeySchema = z.string().min(1).max(600);

/**
 * Storage-agnostic text reader: receives a normalized `<runId>/<relative path>`
 * key. A Node host may inject an fs-backed reader; Workers callers can omit it
 * (or inject an R2/HTTP-backed one). No Node-only modules are imported here.
 */
export type ArtifactTextReader = (key: string) => Promise<string>;

/**
 * Stored artifact paths may be relative to the run directory or include the
 * storage prefix. Normalize them to a path inside `<runId>` using plain string
 * operations only.
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

/**
 * Validate and normalize an artifact key using plain string operations, so
 * traversal and invalid run ids are rejected on every runtime.
 */
export function safeArtifactKey(
  runId: string,
  relativePath: string | null | undefined,
): string | null {
  if (typeof relativePath !== "string") return null;
  if (!RunIdSchema.safeParse(runId).success) return null;
  if (!RelativePathSchema.safeParse(relativePath).success) return null;

  const relative = relativeArtifactPath(runId, relativePath);
  if (!relative) return null;

  const segments = relative.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    return null;
  }

  const key = `${runId}/${segments.join("/")}`;
  return ArtifactKeySchema.safeParse(key).success ? key : null;
}

/**
 * Read a redacted observation/v2 artifact, validating it at the boundary.
 *
 * Missing, unreadable, malformed or otherwise invalid observations are
 * optional; they must never break reading the rest of the analysis. Without an
 * injected reader (the Workers default) this safely yields `undefined`.
 */
export async function readObservation(
  runId: string,
  relativePath: string | null,
  readText?: ArtifactTextReader,
): Promise<unknown | undefined> {
  try {
    const key = safeArtifactKey(runId, relativePath);
    if (!key || !readText) return undefined;

    const text = await readText(key);
    if (typeof text !== "string" || text.length === 0) return undefined;

    const raw: unknown = JSON.parse(text);
    const parsed = ObservationV2Schema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Missing, unreadable, malformed or otherwise invalid observations are
    // optional; they must never break reading the rest of the analysis.
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
