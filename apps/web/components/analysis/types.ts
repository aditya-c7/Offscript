import { z } from "zod";
import { ObservationV2Schema } from "@offscript/shared";

export const OverviewSiteSchema = z.object({
  id: z.string(),
  host: z.string(),
  url: z.string(),
  detectedStack: z.string(),
  lastScanAt: z.string().nullable(),
  scoreOverall: z.number().nullable(),
  find: z.number(),
  understand: z.number(),
  act: z.number(),
  latestVerdict: z.string().nullable(),
  checksPassed: z.number(),
  checksTotal: z.number(),
  topFixes: z.array(z.string()).optional(),
});
export type OverviewSite = z.infer<typeof OverviewSiteSchema>;
export const OverviewResponseSchema = z.object({
  sites: z.array(OverviewSiteSchema),
});

export const AnalysisStepSchema = z.object({
  idx: z.number().int(),
  url: z.string(),
  stateToken: z.string(),
  perceptionMode: z.string(),
  actionJson: z.unknown(),
  policyEventsJson: z.unknown(),
  reasoningSummary: z.string().nullable(),
  screenshotPath: z.string().nullable(),
  observationPath: z.string().nullable(),
  resultStatus: z.string(),
  observation: z.unknown().optional(),
});
export type AnalysisStep = z.infer<typeof AnalysisStepSchema>;

export const AnalysisRunSchema = z.object({
  id: z.string(),
  taskKey: z.string(),
  taskText: z.string(),
  successCriteria: z.string(),
  profile: z.string(),
  status: z.string(),
  verdict: z.string().nullable(),
  answer: z.string().nullable(),
  modelId: z.string(),
  steps: z.array(AnalysisStepSchema),
  verifierJson: z.unknown(),
});
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;

export const AnalysisDetailSchema = z.object({
  analysis: z.object({
    id: z.string(),
    siteId: z.string(),
    status: z.string(),
    host: z.string(),
    creditConsumed: z.boolean(),
    artifactsExpiresAt: z.string().nullable(),
    artifactsDeletedAt: z.string().nullable(),
  }),
  runs: z.array(AnalysisRunSchema),
});
export type AnalysisDetail = z.infer<typeof AnalysisDetailSchema>;

export const CreateResponseSchema = z.object({ id: z.string() });
export const QuotaResponseSchema = z.object({ remaining: z.number() });

export function parseObservation(value: unknown) {
  return ObservationV2Schema.safeParse(value);
}

const WAITING = new Set(["waiting", "queued"]);
const RUNNING = new Set(["running", "active", "in_progress", "processing"]);

export function isWaiting(status: string): boolean {
  return WAITING.has(status);
}

export function isRunning(status: string): boolean {
  return RUNNING.has(status);
}

export function isTerminal(status: string): boolean {
  return !isWaiting(status) && !isRunning(status);
}

export interface TaskGroup {
  key: string;
  taskText: string;
  runs: AnalysisRun[];
}

/** Pair the text-structure and visual-screen runs back into one task. */
export function groupRuns(runs: AnalysisRun[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const bySignature = new Map<string, TaskGroup>();

  for (const run of runs) {
    const signature = `${run.taskKey}|${run.taskText}|${run.successCriteria}`;
    let group = bySignature.get(signature);
    if (!group) {
      group = { key: run.taskKey, taskText: run.taskText, runs: [] };
      bySignature.set(signature, group);
      groups.push(group);
    }
    group.runs.push(run);
  }
  return groups;
}

export function artifactUrl(
  runId: string,
  storedPath: string | null,
): string | null {
  if (!storedPath) return null;
  const parts = storedPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0) return null;
  const runIndex = parts.lastIndexOf(runId);
  const segments = runIndex >= 0 ? parts.slice(runIndex + 1) : parts;
  if (segments.length === 0) return null;
  return `/api/artifacts/${encodeURIComponent(runId)}/${segments
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}
