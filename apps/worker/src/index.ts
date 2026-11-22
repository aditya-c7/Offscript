import PgBoss from "pg-boss";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ARTIFACT_TTL_DAYS,
  PIPELINE_VERSION,
  RUBRIC_VERSION,
  ProfileSchema,
  TaskInputSchema,
  TaskKeySchema,
  normalizeUrl,
} from "@offscript/shared";
import {
  getDb,
  withTransaction,
  hasQuota,
  canSettleAnalysis,
  scans,
  checks,
  sites,
  analyses,
  runs,
  steps,
  settleAnalysisCredit,
} from "@offscript/db";
import {
  crawlSite,
  getBrowser,
  runChecks,
  detectProtocols,
  scoreScan,
  interpretWebsite,
  buildReport,
  type TextJsonModel,
} from "@offscript/scanner";
import {
  getEnv,
  callModelJson,
  createReadOnlyContext,
  captureObservation,
  captureScreenshots as captureScreenshotsImpl,
  assertActionAllowed as assertActionAllowedImpl,
  runTask,
  verifyRun,
  InfraError,
  type RunnerDeps,
} from "@offscript/agent";
// Namespace import so the worker also compiles against router versions that
// do not export `getLastModelSelection` yet. The value is validated at use.
import * as agentModule from "@offscript/agent";
import { startChromiumWatchdog } from "./watchdog.js";
import { createSemaphore, limitForMemory } from "./concurrency.js";

const env = getEnv();
const db = getDb();
const boss = new PgBoss(env.DATABASE_URL);
const storageDir = env.STORAGE_DIR;

const ModelSelectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
});

type ModelSelection = z.infer<typeof ModelSelectionSchema>;

/** First usable model id from a comma-separated role configuration. */
function firstConfiguredModel(raw: string): string {
  return (
    raw
      .split(",")
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0) ?? ""
  );
}

/** Model configured for a run profile: vision runs use the vision model. */
function configuredModelForProfile(profile: string): string {
  return firstConfiguredModel(
    profile === "visual_screen" ? env.LLM_MODEL_VISION : env.LLM_MODEL_AGENT,
  );
}

/**
 * Resolve the provider/model that the LLM router actually used last.
 *
 * The router export is feature-detected because the router package can be
 * deployed slightly ahead of this worker. Everything crossing that module
 * boundary is validated with Zod before use. A recorded model is preferred;
 * the profile-specific configuration is used only when that model is empty.
 */
function currentModelSelection(profile?: string): ModelSelection {
  let recorded: ModelSelection | undefined;
  if ("getLastModelSelection" in agentModule) {
    const candidate: unknown = agentModule.getLastModelSelection;
    const getter = z
      .function()
      .returns(ModelSelectionSchema.optional())
      .safeParse(candidate);
    if (getter.success) recorded = getter.data();
  }
  return {
    provider: recorded?.provider ?? env.LLM_PROVIDER,
    model: recorded?.model || configuredModelForProfile(profile ?? ""),
  };
}

/** details_json is a DB boundary: parse it before it reaches the prompt. */
const RunDetailsSchema = z.object({
  lines: z.array(z.string()).default([]),
});
const RunDetailsArraySchema = z.array(z.string());

/** Normalize a URL so a re-navigation to the same page can be detected. */
function pageHref(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value.trim();
  }
}

function detailsLinesFor(detailsJson: unknown): string[] {
  const direct = RunDetailsArraySchema.safeParse(detailsJson);
  if (direct.success) return direct.data;
  const parsed = RunDetailsSchema.safeParse(detailsJson);
  return parsed.success ? parsed.data.lines : [];
}

/** Only real infrastructure failures become infra_error; everything else is inconclusive. */
function runFailureVerdict(error: unknown): "infra_error" | "no_clear_result" {
  if (error instanceof InfraError) return "infra_error";
  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();
    if (
      name === "timeouterror" ||
      name === "aborterror" ||
      /timeout|timed out/.test(message)
    ) {
      return "infra_error";
    }
  }
  return "no_clear_result";
}

const looseSchema = z.record(z.string(), z.unknown());
const ScanJobSchema = z.object({ scanId: z.string().uuid() });
const AnalysisJobSchema = z.object({ analysisId: z.string().uuid() });
const StepPayloadSchema = z.object({
  runId: z.string(),
  index: z.number().int(),
  atMs: z.number(),
  action: z.unknown().nullable(),
  stateToken: z.string().nullable(),
  observationId: z.string().nullable(),
  url: z.string().nullable(),
  policyEvent: z.unknown().nullable(),
  screenshots: z
    .object({ numberedPath: z.string(), finalPath: z.string() })
    .nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

const SCAN_QUEUE = "scan.site";
const ANALYSIS_QUEUE = "agent.run";

/** Public enqueue names map 1:1 to the queues the worker already consumes. */
const QUEUE_MAP: Readonly<Record<string, string>> = {
  [SCAN_QUEUE]: SCAN_QUEUE,
  [ANALYSIS_QUEUE]: ANALYSIS_QUEUE,
};

const EnqueueBodySchema = z.discriminatedUnion("queue", [
  z.object({ queue: z.literal(SCAN_QUEUE), payload: ScanJobSchema }),
  z.object({ queue: z.literal(ANALYSIS_QUEUE), payload: AnalysisJobSchema }),
]);

const EnqueuePortSchema = z.coerce.number().int().min(1).max(65535);
const EnqueueHostSchema = z.string().min(1);

/** Legacy /enqueue keeps its small cap; the write endpoints need more room. */
const MAX_ENQUEUE_BODY_BYTES = 16 * 1024;
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

/** Owner id is the length-constrained cookie value stored on sites/quotas. */
const OwnerIdSchema = z.string().min(1).max(128);
const UuidSchema = z.string().uuid();

const ScanCreateSchema = z.object({
  ownerId: OwnerIdSchema,
  url: z.string().min(1).max(2048),
  siteId: UuidSchema.optional(),
});

const AnalysisCreateSchema = z.object({
  ownerId: OwnerIdSchema,
  siteId: UuidSchema,
  tasks: z.array(TaskInputSchema).min(1).max(12),
});

/** Body for the re-run / settle endpoints: only the owner is required. */
const OwnerOnlySchema = z.object({ ownerId: OwnerIdSchema });

const PROFILES = ["text_structure", "visual_screen"] as const;

/** Route failure carrying a safe, fixed response code (never a payload). */
class RouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "RouteError";
    this.status = status;
    this.code = code;
  }
}

function enqueueConfig(): { host: string; port: number } {
  const host = EnqueueHostSchema.safeParse(
    process.env.WORKER_ENQUEUE_HOST || "127.0.0.1",
  );
  const port = EnqueuePortSchema.safeParse(
    process.env.WORKER_ENQUEUE_PORT || "8787",
  );
  return {
    host: host.success ? host.data : "127.0.0.1",
    port: port.success ? port.data : 8787,
  };
}

/** Shared secret required on every write endpoint. Blank means "not configured". */
const EnqueueTokenSchema = z.string().trim().min(1);

function enqueueToken(): string {
  const parsed = EnqueueTokenSchema.safeParse(process.env.WORKER_ENQUEUE_TOKEN);
  return parsed.success ? parsed.data : "";
}

/** Length-independent, constant-time comparison of two secrets. */
function secretEqual(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Constant-time bearer check. A missing configured token denies every request
 * (fail closed). Only the status is ever logged — never the token or payload.
 */
export function isAuthorizedEnqueue(req: {
  headers: { authorization?: string | string[] };
}): boolean {
  const expected = enqueueToken();
  if (expected.length === 0) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header);
  const presented = match?.[1];
  if (presented === undefined) return false;
  return secretEqual(presented, expected);
}

function readEnqueueBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limit) {
        settled = true;
        reject(new Error("enqueue body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

type JsonBodyResult =
  { ok: true; value: unknown } | { ok: false; status: number; code: string };

async function readJsonBody(
  req: IncomingMessage,
  limit: number,
): Promise<JsonBodyResult> {
  let raw: string;
  try {
    raw = await readEnqueueBody(req, limit);
  } catch {
    return { ok: false, status: 413, code: "invalid_body" };
  }
  try {
    const value: unknown = JSON.parse(raw);
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, code: "invalid_json" };
  }
}

/** Read and Zod-validate a POST body. Invalid input never reaches the DB. */
async function parseBody<T extends z.ZodTypeAny>(
  req: IncomingMessage,
  limit: number,
  schema: T,
): Promise<z.infer<T>> {
  const body = await readJsonBody(req, limit);
  if (!body.ok) throw new RouteError(body.status, body.code);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) throw new RouteError(400, "invalid_request");
  return parsed.data;
}

type RouteResult = { status: number; body: object };

/** POST /scans — create the owning site (if needed) and a queued scan. */
async function handleScanCreate(req: IncomingMessage): Promise<RouteResult> {
  const input = await parseBody(req, MAX_REQUEST_BODY_BYTES, ScanCreateSchema);

  let normalized: ReturnType<typeof normalizeUrl>;
  try {
    normalized = normalizeUrl(input.url);
  } catch {
    throw new RouteError(400, "invalid_url");
  }

  let scanId = "";
  await withTransaction(async (tx) => {
    let siteId = input.siteId;
    if (siteId === undefined) {
      const insertedSites = await tx
        .insert(sites)
        .values({
          ownerCookieId: input.ownerId,
          url: normalized.href,
          normalizedHost: normalized.host,
          detectedStack: "generic",
        })
        .returning({ id: sites.id });
      const site = insertedSites[0];
      if (!site) throw new RouteError(500, "internal_error");
      siteId = site.id;
    } else {
      const ownedSites = await tx
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(eq(sites.id, siteId), eq(sites.ownerCookieId, input.ownerId)),
        )
        .limit(1);
      if (ownedSites.length === 0) throw new RouteError(404, "site_not_found");
    }

    const insertedScans = await tx
      .insert(scans)
      .values({
        siteId,
        shareToken: randomUUID(),
        status: "queued",
        rubricVersion: RUBRIC_VERSION,
        pipelineVersion: PIPELINE_VERSION,
      })
      .returning({ id: scans.id });
    const scan = insertedScans[0];
    if (!scan) throw new RouteError(500, "internal_error");
    scanId = scan.id;
  });

  await boss.send(SCAN_QUEUE, { scanId });
  return { status: 201, body: { id: scanId } };
}

/** POST /analyses — check quota, insert analysis + runs, then enqueue. */
async function handleAnalysisCreate(
  req: IncomingMessage,
): Promise<RouteResult> {
  const input = await parseBody(
    req,
    MAX_REQUEST_BODY_BYTES,
    AnalysisCreateSchema,
  );

  const ownedSites = await db
    .select({ id: sites.id })
    .from(sites)
    .where(
      and(eq(sites.id, input.siteId), eq(sites.ownerCookieId, input.ownerId)),
    )
    .limit(1);
  if (ownedSites.length === 0) throw new RouteError(404, "site_not_found");

  if (!(await hasQuota(input.ownerId))) {
    throw new RouteError(403, "quota_exceeded");
  }

  const expiresAt = new Date(
    Date.now() + ARTIFACT_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  let analysisId = "";

  await withTransaction(async (tx) => {
    const inserted = await tx
      .insert(analyses)
      .values({
        siteId: input.siteId,
        shareToken: randomUUID(),
        status: "queued",
        attestedAt: new Date(),
        artifactsExpiresAt: expiresAt,
      })
      .returning({ id: analyses.id });
    const analysis = inserted[0];
    if (!analysis) throw new RouteError(500, "internal_error");
    analysisId = analysis.id;

    const runValues = input.tasks.flatMap((task) =>
      PROFILES.map((profile) => ({
        analysisId: analysis.id,
        taskKey: task.task_key,
        profile,
        taskText: task.task_text,
        successCriteria: task.success_criteria,
        persona: task.persona ?? null,
        detailsJson: {
          lines: task.details_lines,
          importance_confidence: task.importance_confidence,
          why_it_matters: task.why_it_matters ?? null,
        },
        importanceConfidence: task.importance_confidence,
        whyItMatters: task.why_it_matters ?? null,
        status: "waiting",
        testId: randomUUID(),
      })),
    );
    await tx.insert(runs).values(runValues);
  });

  await boss.send(ANALYSIS_QUEUE, { analysisId });
  return { status: 201, body: { id: analysisId } };
}

/** POST /scans/:id/again — clone a scan for the same owned site. */
async function handleScanAgain(
  id: string,
  req: IncomingMessage,
): Promise<RouteResult> {
  const { ownerId } = await parseBody(
    req,
    MAX_REQUEST_BODY_BYTES,
    OwnerOnlySchema,
  );

  const rows = await db
    .select({ siteId: scans.siteId })
    .from(scans)
    .innerJoin(sites, eq(scans.siteId, sites.id))
    .where(and(eq(scans.id, id), eq(sites.ownerCookieId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new RouteError(404, "scan_not_found");

  const created = await db
    .insert(scans)
    .values({
      siteId: row.siteId,
      shareToken: randomUUID(),
      status: "queued",
      rubricVersion: RUBRIC_VERSION,
      pipelineVersion: PIPELINE_VERSION,
    })
    .returning({ id: scans.id });
  const scan = created[0];
  if (!scan) throw new RouteError(500, "internal_error");

  await boss.send(SCAN_QUEUE, { scanId: scan.id });
  return { status: 201, body: { id: scan.id } };
}

/** POST /analyses/:id/again — recreate analysis + runs from the original. */
async function handleAnalysisAgain(
  id: string,
  req: IncomingMessage,
): Promise<RouteResult> {
  const { ownerId } = await parseBody(
    req,
    MAX_REQUEST_BODY_BYTES,
    OwnerOnlySchema,
  );

  const rows = await db
    .select({ analysis: analyses })
    .from(analyses)
    .innerJoin(sites, eq(analyses.siteId, sites.id))
    .where(and(eq(analyses.id, id), eq(sites.ownerCookieId, ownerId)))
    .limit(1);
  const original = rows[0];
  if (!original) throw new RouteError(404, "analysis_not_found");

  const originalRuns = await db
    .select()
    .from(runs)
    .where(eq(runs.analysisId, id));
  if (originalRuns.length === 0)
    throw new RouteError(404, "analysis_not_found");

  if (!(await hasQuota(ownerId))) throw new RouteError(403, "quota_exceeded");

  const expiresAt = new Date(
    Date.now() + ARTIFACT_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  let analysisId = "";

  await withTransaction(async (tx) => {
    const inserted = await tx
      .insert(analyses)
      .values({
        siteId: original.analysis.siteId,
        shareToken: randomUUID(),
        status: "queued",
        attestedAt: new Date(),
        artifactsExpiresAt: expiresAt,
      })
      .returning({ id: analyses.id });
    const analysis = inserted[0];
    if (!analysis) throw new RouteError(500, "internal_error");
    analysisId = analysis.id;

    await tx.insert(runs).values(
      originalRuns.map((run) => {
        const taskKey = TaskKeySchema.safeParse(run.taskKey);
        const profile = ProfileSchema.safeParse(run.profile);
        return {
          analysisId: analysis.id,
          taskKey: taskKey.success ? taskKey.data : "custom",
          profile: profile.success ? profile.data : "text_structure",
          taskText: run.taskText,
          successCriteria: run.successCriteria,
          persona: run.persona,
          detailsJson: run.detailsJson,
          importanceConfidence: run.importanceConfidence,
          whyItMatters: run.whyItMatters,
          status: "waiting",
          testId: randomUUID(),
        };
      }),
    );
  });

  await boss.send(ANALYSIS_QUEUE, { analysisId });
  return { status: 201, body: { id: analysisId } };
}

/** POST /analyses/:id/settle — settle the credit once all runs are terminal. */
async function handleAnalysisSettle(
  id: string,
  req: IncomingMessage,
): Promise<RouteResult> {
  const { ownerId } = await parseBody(
    req,
    MAX_REQUEST_BODY_BYTES,
    OwnerOnlySchema,
  );

  const rows = await db
    .select({ id: analyses.id })
    .from(analyses)
    .innerJoin(sites, eq(analyses.siteId, sites.id))
    .where(and(eq(analyses.id, id), eq(sites.ownerCookieId, ownerId)))
    .limit(1);
  if (rows.length === 0) throw new RouteError(404, "analysis_not_found");

  // Idempotent: returns false while any run is still in flight or if the
  // analysis was already settled. Never throws on a re-run.
  if (!(await canSettleAnalysis(id))) {
    return { status: 200, body: { credited: false } };
  }

  const { credited } = await settleAnalysisCredit(id);
  return { status: 200, body: { credited } };
}

/** Dispatch every write endpoint. Bodies and ids are validated before use. */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = (req.url ?? "").split("?")[0] ?? "";
  if (req.method !== "POST") {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  // Authenticate before reading the body: unauthenticated callers never reach
  // a route, the database, or pg-boss. Log the status only, never the header.
  if (!isAuthorizedEnqueue(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    console.warn("[offscript] enqueue request rejected", 401);
    return;
  }

  try {
    let result: RouteResult;
    if (path === "/enqueue") {
      // Legacy enqueue kept exactly as before for existing callers.
      const { queue, payload } = await parseBody(
        req,
        MAX_ENQUEUE_BODY_BYTES,
        EnqueueBodySchema,
      );
      await boss.send(QUEUE_MAP[queue] ?? queue, payload);
      result = { status: 200, body: { ok: true } };
    } else if (path === "/scans") {
      result = await handleScanCreate(req);
    } else if (path === "/analyses") {
      result = await handleAnalysisCreate(req);
    } else {
      const scanAgain = /^\/scans\/([^/]+)\/again$/.exec(path);
      const analysisAgain = /^\/analyses\/([^/]+)\/again$/.exec(path);
      const analysisSettle = /^\/analyses\/([^/]+)\/settle$/.exec(path);
      if (scanAgain?.[1]) {
        result = await handleScanAgain(UuidSchema.parse(scanAgain[1]), req);
      } else if (analysisAgain?.[1]) {
        result = await handleAnalysisAgain(
          UuidSchema.parse(analysisAgain[1]),
          req,
        );
      } else if (analysisSettle?.[1]) {
        result = await handleAnalysisSettle(
          UuidSchema.parse(analysisSettle[1]),
          req,
        );
      } else {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
    }
    sendJson(res, result.status, result.body);
  } catch (error: unknown) {
    if (error instanceof RouteError) {
      sendJson(res, error.status, { error: error.code });
    } else if (error instanceof z.ZodError) {
      sendJson(res, 400, { error: "invalid_request" });
    } else {
      sendJson(res, 500, { error: "internal_error" });
    }
    // Never log request bodies, payloads, or environment values.
    console.error(
      "[offscript] enqueue server error",
      error instanceof Error ? error.name : "unknown",
    );
  }
}

/** Loopback-only HTTP front door for the web app's enqueue/write client. */
function startEnqueueServer(): void {
  const { host, port } = enqueueConfig();
  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
      console.error(
        "[offscript] enqueue server error",
        error instanceof Error ? error.name : "unknown",
      );
    });
  });
  server.on("error", (error: Error) => {
    console.error("[offscript] enqueue server error", error.name);
  });
  server.listen(port, host, () => {
    console.log("[offscript] enqueue server listening");
  });
}

const interpretationModel: TextJsonModel = async ({ system, user }) => {
  const result = await callModelJson(
    "fast",
    looseSchema,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxRepairRetries: 2 },
  );
  return result.value;
};

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function processScan(data: unknown): Promise<void> {
  const { scanId } = ScanJobSchema.parse(data);
  const scanRow = (
    await db.select().from(scans).where(eq(scans.id, scanId))
  ).at(0);
  if (!scanRow) return;

  await db
    .update(scans)
    .set({ status: "running", startedAt: new Date(), errorCode: null })
    .where(eq(scans.id, scanRow.id));

  const browser = await getBrowser();
  try {
    await withTimeout(
      (async () => {
        const siteRow = (
          await db.select().from(sites).where(eq(sites.id, scanRow.siteId))
        ).at(0);
        const ctx = await crawlSite(
          siteRow?.url ?? scanRow.shareToken,
          browser,
        );
        const checkResults = runChecks(ctx);
        const protocols = detectProtocols(ctx);
        const scores = scoreScan(ctx, checkResults, protocols);
        const interpretation = await interpretWebsite(
          ctx,
          interpretationModel,
        ).catch(() => null);
        const report = buildReport({
          id: scanRow.id,
          shareToken: scanRow.shareToken,
          ctx,
          checks: checkResults,
          protocols,
          scores,
          interpretation,
          detectedStack: ctx.detectedStack,
        });
        const selection = currentModelSelection();

        await db.delete(checks).where(eq(checks.scanId, scanRow.id));
        await db.insert(checks).values(
          checkResults.map((c) => ({
            scanId: scanRow.id,
            key: c.key,
            category: c.category,
            area: c.area,
            verdict: c.verdict,
            confidence: c.confidence,
            impact: c.impact,
            pageUrl: c.page_url,
            selector: c.selector,
            snippet: c.snippet,
            reproduceCmd: c.reproduce_cmd,
            fixPromptsJson: { markdown: c.fix_prompt_md },
            evidenceJson: c.evidence,
          })),
        );

        await db
          .update(scans)
          .set({
            status: "complete",
            scoreFind: scores.find,
            scoreUnderstand: scores.understand,
            scoreAct: scores.act,
            scoreProtocols: scores.protocols,
            standardsModifier: scores.standards_modifier,
            scoreOverall: scores.overall,
            coverageJson: {
              pages_checked: report.pages_checked,
              pages_opened_browser: report.pages_opened_browser,
              possible_pages_found: report.possible_pages_found,
              sampled_urls: report.sampled_urls,
              provider: selection.provider,
              model: selection.model,
              model_selection: {
                provider: selection.provider,
                model: selection.model,
              },
            },
            interpretationJson: interpretation,
            protocolsJson: protocols,
            completedAt: new Date(),
          })
          .where(eq(scans.id, scanRow.id));

        if (siteRow) {
          await db
            .update(sites)
            .set({ detectedStack: ctx.detectedStack })
            .where(eq(sites.id, siteRow.id));
        }
      })(),
      120_000,
      "scan.site",
    );
  } catch (error) {
    await db
      .update(scans)
      .set({
        status: "failed",
        errorCode: error instanceof Error ? error.name : "unknown_error",
        completedAt: new Date(),
      })
      .where(eq(scans.id, scanRow.id));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function processAnalysis(data: unknown): Promise<void> {
  const { analysisId } = AnalysisJobSchema.parse(data);
  const analysisRow = (
    await db.select().from(analyses).where(eq(analyses.id, analysisId))
  ).at(0);
  if (!analysisRow) return;

  const siteRow = (
    await db.select().from(sites).where(eq(sites.id, analysisRow.siteId))
  ).at(0);
  if (!siteRow) return;

  await db
    .update(analyses)
    .set({ status: "running" })
    .where(eq(analyses.id, analysisRow.id));

  const browser = await getBrowser();
  let readOnly: Awaited<ReturnType<typeof createReadOnlyContext>> | undefined;
  try {
    readOnly = await createReadOnlyContext(browser);
    const allRuns = (await db.select().from(runs)).filter(
      (r) => r.analysisId === analysisRow.id,
    );

    let hasVerifiedResult = false;

    for (const run of allRuns) {
      const page = await readOnly.context.newPage();
      try {
        // The agent needs a starting page, but a second navigation to the very
        // same URL would yield an identical state token and a false repeat.
        const originalGoto = page.goto.bind(page);
        const startHref = pageHref(siteRow.url);
        let skipDuplicateNavigation = true;
        page.goto = async (url, options) => {
          if (
            skipDuplicateNavigation &&
            typeof url === "string" &&
            pageHref(url) === startHref
          ) {
            skipDuplicateNavigation = false;
            return null;
          }
          return originalGoto(url, options);
        };
        await originalGoto(siteRow.url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });

        const screenshotPaths: string[] = [];
        const deps: RunnerDeps = {
          captureObservation,
          captureScreenshots: async ({
            page: shotPage,
            outDir,
            runId,
            step,
          }) => {
            const observation = await captureObservation(shotPage);
            const artifacts = await captureScreenshotsImpl({
              page: shotPage,
              targets: observation.targets,
              outDir,
              runId,
              idx: step,
            });
            screenshotPaths.push(artifacts.numberedPath, artifacts.finalPath);
            return artifacts;
          },
          assertActionAllowed: (action, target) =>
            assertActionAllowedImpl(action, target),
          callJson: callModelJson,
          persistStep: async (step: unknown) => {
            const s = StepPayloadSchema.parse(step);
            const reasoning =
              typeof s.metadata.reasoning === "string"
                ? s.metadata.reasoning
                : "";
            const resultStatus =
              typeof s.metadata.resultStatus === "string"
                ? s.metadata.resultStatus
                : "ok";
            const observationPath =
              typeof s.metadata.observationPath === "string"
                ? s.metadata.observationPath
                : `${storageDir}/${s.runId}/${s.index}.observation.json`;
            await db
              .insert(steps)
              .values({
                runId: run.id,
                idx: s.index,
                url: s.url ?? "",
                stateToken: s.stateToken ?? "",
                perceptionMode: run.profile,
                actionJson: s.action ?? null,
                policyEventsJson: s.policyEvent ?? null,
                reasoningSummary: reasoning.slice(0, 280),
                screenshotPath: s.screenshots?.finalPath ?? null,
                observationPath,
                resultStatus,
              })
              .onConflictDoNothing();
          },
        };

        const result = await withTimeout(
          runTask({
            page,
            profile:
              run.profile === "visual_screen"
                ? "visual_screen"
                : "text_structure",
            task: run.taskText,
            successCriteria: run.successCriteria,
            detailsLines: detailsLinesFor(run.detailsJson),
            outDir: storageDir,
            runId: run.id,
            deps,
          }),
          300_000,
          "agent.run",
        );

        const verification = await verifyRun({
          successCriteria: run.successCriteria,
          finalAnswer: result.answer,
          evidenceQuotes: result.evidenceQuotes,
          screenshots: screenshotPaths,
        }).catch(() => null);
        // The runner's verdict is authoritative; the verifier is supporting evidence.
        const verdict = result.verdict;
        if (verdict === "pass" || verdict === "fail") hasVerifiedResult = true;
        const selection = currentModelSelection(run.profile);

        await db
          .update(runs)
          .set({
            status: "done",
            verdict,
            answer: result.answer,
            verifierJson: verification,
            tokenInputTotal: result.inputTokens,
            tokenOutputTotal: result.outputTokens,
            modelId: selection.model,
          })
          .where(eq(runs.id, run.id));
      } catch (error) {
        console.error(
          "[offscript] agent run failed",
          error instanceof Error ? error.message : String(error),
        );
        await db
          .update(runs)
          .set({
            status: "done",
            verdict: runFailureVerdict(error),
            answer: null,
          })
          .where(eq(runs.id, run.id));
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    await db
      .update(analyses)
      .set({ status: "complete", attestedAt: new Date() })
      .where(eq(analyses.id, analysisRow.id));
    if (hasVerifiedResult) await settleAnalysisCredit(analysisRow.id);
  } catch {
    await db
      .update(analyses)
      .set({ status: "failed" })
      .where(eq(analyses.id, analysisRow.id));
  } finally {
    if (readOnly) await readOnly.context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  startEnqueueServer();
  await boss.start();
  await boss.createQueue(SCAN_QUEUE);
  await boss.createQueue(ANALYSIS_QUEUE);

  const browserSlots = createSemaphore(
    limitForMemory(Number(process.env.WORKER_MEMORY_MB ?? 4096)),
  );

  await boss.work(SCAN_QUEUE, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    const release = await browserSlots.acquire();
    try {
      await processScan(job.data);
    } finally {
      release();
    }
  });
  await boss.work(ANALYSIS_QUEUE, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    const release = await browserSlots.acquire();
    try {
      await processAnalysis(job.data);
    } finally {
      release();
    }
  });

  startChromiumWatchdog();
  console.log("Offscript worker started (scan.site, agent.run)");
}

// Unit tests import this module offline (VITEST=true) to exercise the auth
// guard directly; they must never bind a real port or start pg-boss/Chromium.
if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(
      "Worker failed to start",
      error instanceof Error ? error.message : "unknown",
    );
    process.exitCode = 1;
  });
}
