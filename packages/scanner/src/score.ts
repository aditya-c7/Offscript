/** Deterministic scoring for the Offscript rubric. */
import type {
  Area,
  CheckResult,
  Impact,
  ProtocolResult,
  ScanContext,
  ScoreBlock,
  Verdict,
} from "@offscript/shared";

const IMPACT_WEIGHT: Record<Impact, number> = { major: 3, supporting: 1 };
const VERDICT_VALUE: Record<Verdict, number> = {
  pass: 1,
  partial: 0.5,
  fail: 0,
  not_applicable: 0,
};

function scoreArea(checks: readonly CheckResult[], area: Area): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const check of checks) {
    if (check.area !== area || check.verdict === "not_applicable") continue;
    const weight = IMPACT_WEIGHT[check.impact];
    weighted += weight * VERDICT_VALUE[check.verdict];
    totalWeight += weight;
  }
  return totalWeight === 0 ? 100 : (100 * weighted) / totalWeight;
}

/**
 * Find/Understand/Act are weighted major=3, supporting=1; not_applicable is
 * excluded. Overall deliberately excludes Act and is capped at 100.
 */
export function scoreScan(
  ctx: ScanContext,
  checks: readonly CheckResult[],
  protocols: readonly ProtocolResult[],
): ScoreBlock {
  void ctx;
  const find = scoreArea(checks, "find");
  const understand = scoreArea(checks, "understand");
  const act = scoreArea(checks, "act");
  const found = protocols.filter((protocol) => protocol.found).length;
  const protocolScore = (100 * found) / 7;
  const standardsModifier = Math.min(5, Math.max(0, 5 * (protocolScore / 100)));
  const overall = Math.min(
    100,
    0.45 * find + 0.55 * understand + standardsModifier,
  );
  return {
    find,
    understand,
    act,
    protocols: protocolScore,
    standards_modifier: standardsModifier,
    overall,
  };
}
