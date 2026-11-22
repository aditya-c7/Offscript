import PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getDb,
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
  classifyInfraError,
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

/**
 * Resolve the provider/model that the LLM router actually used last.
 *
 * The router export is feature-detected because the router package can be
 * deployed slightly ahead of this worker. Everything crossing that module
 * boundary is validated with Zod before use. When nothing was recorded, fall
 * back to the configured provider/model so persistence never goes blank.
 */
function currentModelSelection(): ModelSelection {
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
    model: recorded?.model ?? env.LLM_MODEL_AGENT,
  };
}

const looseSchema = z.record(z.string(), z.unknown());
const ScanJobSchema = z.object({ scanId: z.string().uuid() });
const AnalysisJobSchema = z.object({ analysisId: z.string().uuid() });
const StepPayloadSchema = z.object({
  runId: z.string(),
  index: z.number().int(),
  atMs: z.number(),
  action: z.unknown().nullable(),
  stateToken: z.string(),
  observationId: z.string(),
  url: z.string(),
  policyEvent: z.unknown().nullable(),
  screenshots: z
    .object({ numberedPath: z.string(), finalPath: z.string() })
    .nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

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

    for (const run of allRuns) {
      const page = await readOnly.context.newPage();
      try {
        await page.goto(siteRow.url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });

        const deps: RunnerDeps = {
          captureObservation,
          captureScreenshots: async ({ page, outDir, runId, step }) => {
            const observation = await captureObservation(page);
            return captureScreenshotsImpl({
              page,
              targets: observation.targets,
              outDir,
              runId,
              idx: step,
            });
          },
          assertActionAllowed: (action, target) =>
            assertActionAllowedImpl(action, {
              role: target?.role ?? "",
              name: target?.name ?? "",
              destination: target?.destination ?? null,
            }),
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
                url: s.url,
                stateToken: s.stateToken,
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
            detailsLines: [],
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
          screenshots: [],
        });
        const verdict =
          result.verdict === "infra_error"
            ? "infra_error"
            : verification.verdict;
        const selection = currentModelSelection();

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
        await db
          .update(runs)
          .set({
            status: "done",
            verdict: classifyInfraError(error),
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
    await settleAnalysisCredit(analysisRow.id);
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
  await boss.start();
  await boss.createQueue("scan.site");
  await boss.createQueue("agent.run");

  const browserSlots = createSemaphore(
    limitForMemory(Number(process.env.WORKER_MEMORY_MB ?? 4096)),
  );

  await boss.work("scan.site", { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    const release = await browserSlots.acquire();
    try {
      await processScan(job.data);
    } finally {
      release();
    }
  });
  await boss.work("agent.run", { batchSize: 1 }, async ([job]) => {
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

main().catch((error) => {
  console.error(
    "Worker failed to start",
    error instanceof Error ? error.message : "unknown",
  );
  process.exitCode = 1;
});
