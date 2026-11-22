import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb, withTransaction } from "./client.js";
import { analyses, browserQuotas, runs, sites, steps } from "./schema.js";

/** Number of analysis credits a brand-new owner cookie receives. */
const DEFAULT_ANALYSES_REMAINING = 3;

/**
 * Pure settlement decision. A verified `pass`/`fail` run earns exactly one
 * credit deduction; `no_clear_result` and `infra_error` never do. Once an
 * analysis has been settled it can never be settled again, regardless of what
 * the run verdicts say.
 */
export function decideSettlement(
  runVerdicts: Array<string | null>,
  creditConsumed: boolean,
): { shouldSettle: boolean; shouldCredit: boolean } {
  if (creditConsumed) {
    return { shouldSettle: false, shouldCredit: false };
  }

  const hasVerifiedResult = runVerdicts.some(
    (verdict) => verdict === "pass" || verdict === "fail",
  );

  return { shouldSettle: true, shouldCredit: hasVerifiedResult };
}

/** Return the number of analysis credits remaining for an owner cookie. */
export async function getOrCreateQuota(ownerCookieId: string): Promise<number> {
  const db = getDb();

  await db
    .insert(browserQuotas)
    .values({
      ownerCookieId,
      analysesRemaining: DEFAULT_ANALYSES_REMAINING,
    })
    .onConflictDoNothing({ target: browserQuotas.ownerCookieId });

  const rows = await db
    .select({ analysesRemaining: browserQuotas.analysesRemaining })
    .from(browserQuotas)
    .where(eq(browserQuotas.ownerCookieId, ownerCookieId))
    .limit(1);

  return rows[0]?.analysesRemaining ?? DEFAULT_ANALYSES_REMAINING;
}

/** True when the owner cookie still has at least one analysis credit. */
export async function hasQuota(ownerCookieId: string): Promise<boolean> {
  const remaining = await getOrCreateQuota(ownerCookieId);
  return remaining >= 1;
}

/**
 * Idempotently settle a finished analysis. All reads and writes happen inside
 * one transaction; the analysis row is locked with SELECT ... FOR UPDATE so a
 * concurrent caller cannot consume the same credit twice.
 */
export async function settleAnalysisCredit(
  analysisId: string,
): Promise<{ credited: boolean }> {
  return withTransaction(async (tx) => {
    const lockedRows = await tx
      .select({
        id: analyses.id,
        creditConsumed: analyses.creditConsumed,
      })
      .from(analyses)
      .where(eq(analyses.id, analysisId))
      .for("update")
      .limit(1);

    const analysis = lockedRows[0];
    if (analysis === undefined) {
      return { credited: false };
    }

    const runRows = await tx
      .select({ verdict: runs.verdict })
      .from(runs)
      .where(eq(runs.analysisId, analysisId));

    const decision = decideSettlement(
      runRows.map((row) => row.verdict),
      analysis.creditConsumed,
    );

    if (!decision.shouldSettle) {
      return { credited: false };
    }

    if (decision.shouldCredit) {
      const ownerRows = await tx
        .select({ ownerCookieId: sites.ownerCookieId })
        .from(analyses)
        .innerJoin(sites, eq(analyses.siteId, sites.id))
        .where(eq(analyses.id, analysisId))
        .limit(1);

      const ownerCookieId = ownerRows[0]?.ownerCookieId;
      if (ownerCookieId === undefined) {
        // A dangling foreign key would be an infrastructure error. Throwing
        // rolls the transaction back so no credit is consumed and no
        // `creditConsumed` flag is left behind.
        throw new Error(`No owner found for analysis ${analysisId}`);
      }

      await tx
        .insert(browserQuotas)
        .values({
          ownerCookieId,
          analysesRemaining: DEFAULT_ANALYSES_REMAINING,
        })
        .onConflictDoNothing({ target: browserQuotas.ownerCookieId });

      await tx
        .update(browserQuotas)
        .set({
          analysesRemaining: sql<number>`greatest(${browserQuotas.analysesRemaining} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(browserQuotas.ownerCookieId, ownerCookieId));
    }

    // Always mark the analysis settled, even when nothing was credited. This
    // prevents a later verdict update from consuming a credit retroactively.
    await tx
      .update(analyses)
      .set({ creditConsumed: true })
      .where(eq(analyses.id, analysisId));

    return { credited: decision.shouldCredit };
  });
}

/** Mark artifacts deleted and clear the stored artifact paths for an analysis. */
export async function markArtifactsDeleted(analysisId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await tx
      .update(analyses)
      .set({ artifactsDeletedAt: new Date() })
      .where(eq(analyses.id, analysisId));

    await tx
      .update(steps)
      .set({ screenshotPath: null, observationPath: null })
      .where(
        inArray(
          steps.runId,
          tx
            .select({ id: runs.id })
            .from(runs)
            .where(eq(runs.analysisId, analysisId)),
        ),
      );
  });
}

/**
 * Find expired, not-yet-deleted analyses, mark them deleted, clear their
 * artifact paths, and return the number of analyses purged.
 */
export async function purgeExpiredArtifacts(): Promise<number> {
  return withTransaction(async (tx) => {
    const now = new Date();

    const expiredRows = await tx
      .select({ id: analyses.id })
      .from(analyses)
      .where(
        and(
          isNull(analyses.artifactsDeletedAt),
          lt(analyses.artifactsExpiresAt, now),
        ),
      );

    const expiredIds = expiredRows.map((row) => row.id);
    if (expiredIds.length === 0) {
      return 0;
    }

    await tx
      .update(analyses)
      .set({ artifactsDeletedAt: now })
      .where(inArray(analyses.id, expiredIds));

    await tx
      .update(steps)
      .set({ screenshotPath: null, observationPath: null })
      .where(
        inArray(
          steps.runId,
          tx
            .select({ id: runs.id })
            .from(runs)
            .where(inArray(runs.analysisId, expiredIds)),
        ),
      );

    return expiredIds.length;
  });
}
