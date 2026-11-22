/** Assemble the final, versioned scan report. */
import {
  CATEGORY_META,
  CHECK_META,
  PIPELINE_VERSION,
  RUBRIC_VERSION,
  STACKS,
  type CheckKey,
  type CheckResult,
  type Defect,
  type Interpretation,
  type ProtocolResult,
  type ScanContext,
  type ScanReport,
  type ScoreBlock,
  type Stack,
} from "@offscript/shared";
import { buildFixPrompts } from "./fix-prompts.js";

export interface BuildReportArgs {
  id: string;
  shareToken: string;
  ctx: ScanContext;
  checks: CheckResult[];
  protocols: ProtocolResult[];
  scores: ScoreBlock;
  interpretation: Interpretation | null;
  detectedStack: Stack;
}

function isCheckKey(key: string): key is CheckKey {
  return Object.prototype.hasOwnProperty.call(CHECK_META, key);
}

/** Group, rank and render a scan into the public report shape. */
export function buildReport(args: BuildReportArgs): ScanReport {
  const { ctx, checks, protocols, scores, interpretation, detectedStack } =
    args;

  const categories: ScanReport["categories"] = CATEGORY_META.map((meta) => {
    const categoryChecks = checks.filter(
      (check) => check.category === meta.key,
    );
    const passed = categoryChecks.filter(
      (check) => check.verdict === "pass",
    ).length;
    const total = categoryChecks.length;
    const rate = total === 0 ? 1 : passed / total;
    const badge: "good" | "needs_work" | "poor" =
      rate >= 0.8 ? "good" : rate >= 0.5 ? "needs_work" : "poor";
    return {
      key: meta.key,
      title: meta.title,
      subtitle: meta.subtitle,
      passed,
      total,
      badge,
      checks: categoryChecks,
    };
  });

  const defects: Defect[] = checks
    .filter((check) => check.verdict === "fail" || check.verdict === "partial")
    .map((check): Defect => ({
      check_key: check.key,
      title: isCheckKey(check.key) ? CHECK_META[check.key].title : check.key,
      priority: check.impact === "major" ? "high" : "important",
      area: check.area,
      affected_urls: [check.page_url],
      fix_prompts: STACKS.map((stack) => buildFixPrompts(check, stack.key)),
    }))
    .sort(
      (a, b) =>
        (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1),
    );

  const headline =
    scores.overall >= 80
      ? "Agents can use this site"
      : scores.overall >= 50
        ? "Agents will struggle with parts of this site"
        : "Agents cannot reliably use this site";
  const verdict =
    scores.overall >= 80
      ? "agents_can_use"
      : scores.overall >= 50
        ? "agents_struggle"
        : "agents_cannot";

  const checksPassed = checks.filter(
    (check) => check.verdict === "pass",
  ).length;
  const openedInBrowser = ctx.pages.filter(
    (page) =>
      page.settledMs > 0 ||
      page.pageErrors.length > 0 ||
      page.renderedHtml !== page.rawHtml,
  ).length;

  return {
    id: args.id,
    share_token: args.shareToken,
    host: ctx.host,
    submitted_url: ctx.submittedUrl,
    scanned_at: new Date().toISOString(),
    status: "complete",
    rubric_version: RUBRIC_VERSION,
    pipeline_version: PIPELINE_VERSION,
    verdict,
    headline,
    scores,
    checks_passed: checksPassed,
    checks_total: checks.length,
    pages_checked: ctx.pages.length,
    pages_opened_browser: openedInBrowser,
    possible_pages_found: ctx.possiblePagesFound,
    sampled_urls: ctx.sampledUrls,
    detected_stack: detectedStack,
    categories,
    defects,
    protocols,
    interpretation,
    findings: checks.map((check) => ({
      key: check.key,
      verdict: check.verdict,
      confidence: check.confidence,
      impact: check.impact,
      url: check.page_url,
      selector: check.selector,
      snippet: check.snippet,
      evidence_json: check.evidence,
    })),
  };
}
