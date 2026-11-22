import {
  CATEGORY_META,
  CHECK_KEYS,
  CHECK_META,
  FixPromptSchema,
  ImpactSchema,
  InterpretationSchema,
  ProtocolResultSchema,
  ReportVerdictSchema,
  StackSchema,
  VerdictSchema,
  type Area,
  type CheckMeta,
  type CheckResult,
  type Defect,
  type ReportVerdict,
  type ScanReport,
} from "@offscript/shared";
import { z } from "zod";

/* Structural row shapes: drizzle rows satisfy these without importing types
 * from another package's barrel. */
export interface ReportScanRow {
  id: string;
  shareToken: string;
  status: string;
  rubricVersion: string;
  pipelineVersion: string;
  scoreFind: number | null;
  scoreUnderstand: number | null;
  scoreAct: number | null;
  scoreProtocols: number | null;
  standardsModifier: number | null;
  scoreOverall: number | null;
  coverageJson: unknown;
  interpretationJson: unknown;
  protocolsJson: unknown;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ReportSiteRow {
  url: string;
  normalizedHost: string;
  detectedStack: string;
}

export interface ReportCheckRow {
  key: string;
  category: string;
  area: string;
  verdict: string;
  confidence: number;
  impact: string;
  pageUrl: string;
  selector: string | null;
  snippet: string | null;
  reproduceCmd: string;
  fixPromptsJson: unknown;
  evidenceJson: unknown;
}

const StatusSchema = z.enum(["queued", "running", "complete", "failed"]);
const EvidenceSchema = z.record(z.string(), z.unknown());
const FixPromptLiteSchema = z
  .object({
    title: z.string().optional(),
    combined_md: z.string().optional(),
    markdown: z.string().optional(),
  })
  .passthrough();
const CoverageSchema = z
  .object({
    pages_checked: z.number().int().optional(),
    pages_opened_browser: z.number().int().optional(),
    possible_pages_found: z.number().int().optional(),
    sampled_urls: z.array(z.string()).optional(),
    pagesChecked: z.number().int().optional(),
    pagesOpenedBrowser: z.number().int().optional(),
    possiblePagesFound: z.number().int().optional(),
    sampledUrls: z.array(z.string()).optional(),
  })
  .passthrough();

export function metaForCheck(key: string): CheckMeta | undefined {
  const found = CHECK_KEYS.find((candidate) => candidate === key);
  return found ? CHECK_META[found] : undefined;
}

export function deriveVerdict(overall: number): ReportVerdict {
  if (overall >= 75) return "agents_can_use";
  if (overall >= 45) return "agents_struggle";
  return "agents_cannot";
}

export function verdictHeadline(verdict: ReportVerdict): string {
  if (verdict === "agents_can_use") return "Agents can use this site";
  if (verdict === "agents_struggle") return "Agents struggle with this site";
  return "Agents cannot use this site";
}

function boundedNumber(value: unknown, fallback: number): number {
  const parsed = z.number().min(0).max(100).safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function areaScore(area: Area, results: CheckResult[]): number {
  const relevant = results.filter((result) => result.area === area);
  if (relevant.length === 0) return 0;
  const total = relevant.reduce(
    (sum, result) =>
      sum +
      (result.verdict === "pass" ? 100 : result.verdict === "partial" ? 50 : 0),
    0,
  );
  return Math.round(total / relevant.length);
}

function parseFixPromptLites(
  raw: unknown,
): z.output<typeof FixPromptLiteSchema>[] {
  const array = z.array(FixPromptLiteSchema).safeParse(raw);
  if (array.success) return array.data;
  const single = FixPromptLiteSchema.safeParse(raw);
  return single.success ? [single.data] : [];
}

function toCheckResult(row: ReportCheckRow): CheckResult {
  const verdict = VerdictSchema.safeParse(row.verdict);
  const impact = ImpactSchema.safeParse(row.impact);
  const area = z.enum(["find", "understand", "act"]).safeParse(row.area);
  const category = z
    .enum(["reaching", "reading", "act", "identity"])
    .safeParse(row.category);
  const evidence = EvidenceSchema.safeParse(row.evidenceJson);
  const confidence = z.number().min(0).max(1).safeParse(row.confidence);
  const fixPrompts = parseFixPromptLites(row.fixPromptsJson);
  const combined = fixPrompts.find(
    (prompt) =>
      typeof prompt.combined_md === "string" ||
      typeof prompt.markdown === "string",
  );
  const fixMarkdown = combined?.combined_md ?? combined?.markdown;

  return {
    key: row.key,
    category: category.success ? category.data : "reaching",
    area: area.success ? area.data : "find",
    verdict: verdict.success ? verdict.data : "not_applicable",
    impact: impact.success ? impact.data : "supporting",
    confidence: confidence.success ? confidence.data : 0,
    page_url: row.pageUrl,
    selector: row.selector,
    snippet: row.snippet,
    reproduce_cmd: row.reproduceCmd,
    fix_prompt_md: typeof fixMarkdown === "string" ? fixMarkdown : "",
    evidence: evidence.success ? evidence.data : {},
  };
}

/** Assemble a fully typed ScanReport from persisted scan/check rows. */
export function buildScanReport(
  scan: ReportScanRow,
  site: ReportSiteRow,
  checkRows: ReportCheckRow[],
): ScanReport {
  const statusParsed = StatusSchema.safeParse(scan.status);
  const status = statusParsed.success ? statusParsed.data : "queued";

  const checkResults = checkRows.map(toCheckResult);
  const passed = checkResults.filter(
    (check) => check.verdict === "pass",
  ).length;

  const coverageParsed = CoverageSchema.safeParse(scan.coverageJson);
  const coverage = coverageParsed.success ? coverageParsed.data : {};

  const protocolsParsed = z
    .array(ProtocolResultSchema)
    .safeParse(scan.protocolsJson);
  const protocols = protocolsParsed.success ? protocolsParsed.data : [];
  const protocolScore =
    protocols.length === 0
      ? 0
      : Math.round(
          (protocols.filter((protocol) => protocol.found).length /
            protocols.length) *
            100,
        );

  const interpretationParsed = InterpretationSchema.safeParse(
    scan.interpretationJson,
  );
  const interpretation = interpretationParsed.success
    ? interpretationParsed.data
    : null;

  const find = boundedNumber(scan.scoreFind, areaScore("find", checkResults));
  const understand = boundedNumber(
    scan.scoreUnderstand,
    areaScore("understand", checkResults),
  );
  const act = boundedNumber(scan.scoreAct, areaScore("act", checkResults));
  const standards = boundedNumber(scan.standardsModifier, 0);
  const protocolsScore = boundedNumber(scan.scoreProtocols, protocolScore);
  const overall = boundedNumber(
    scan.scoreOverall,
    Math.round(
      find * 0.3 + understand * 0.3 + act * 0.3 + protocolsScore * 0.1,
    ) + Math.min(5, standards),
  );

  const storedVerdict = z
    .object({ verdict: z.string() })
    .safeParse(scan.coverageJson);
  const verdictParsed = ReportVerdictSchema.safeParse(
    storedVerdict.success ? storedVerdict.data.verdict : undefined,
  );
  const verdict = verdictParsed.success
    ? verdictParsed.data
    : deriveVerdict(overall);

  const categories = CATEGORY_META.map((meta) => {
    const inCategory = checkResults.filter(
      (check) => metaForCheck(check.key)?.category === meta.key,
    );
    const categoryPassed = inCategory.filter(
      (check) => check.verdict === "pass",
    ).length;
    const ratio =
      inCategory.length === 0 ? 0 : categoryPassed / inCategory.length;
    return {
      key: meta.key,
      title: meta.title,
      subtitle: meta.subtitle,
      passed: categoryPassed,
      total: inCategory.length,
      badge: (ratio >= 0.8 ? "good" : ratio >= 0.4 ? "needs_work" : "poor") as
        "good" | "needs_work" | "poor",
      checks: inCategory,
    };
  });

  const fixPromptsByKey = new Map<string, unknown>();
  for (const row of checkRows) fixPromptsByKey.set(row.key, row.fixPromptsJson);

  const defects: Defect[] = checkResults
    .filter((check) => check.verdict === "fail" || check.verdict === "partial")
    .map((check) => {
      const prompts = parseFixPromptLites(fixPromptsByKey.get(check.key));
      const valid = prompts.flatMap((prompt) => {
        const parsed = FixPromptSchema.safeParse(prompt);
        return parsed.success ? [parsed.data] : [];
      });
      return {
        check_key: check.key,
        title: metaForCheck(check.key)?.title ?? check.key,
        priority: check.impact === "major" ? "high" : "important",
        area: check.area,
        affected_urls: [check.page_url],
        fix_prompts: valid,
      };
    });

  const sampledUrls = coverage.sampled_urls ?? coverage.sampledUrls ?? [];
  const distinctPages = new Set(checkResults.map((check) => check.page_url))
    .size;
  const stackParsed = StackSchema.safeParse(site.detectedStack);

  return {
    id: scan.id,
    share_token: scan.shareToken,
    host: site.normalizedHost,
    submitted_url: site.url,
    scanned_at: (scan.completedAt ?? scan.createdAt).toISOString(),
    status,
    rubric_version: scan.rubricVersion,
    pipeline_version: scan.pipelineVersion,
    verdict,
    headline: verdictHeadline(verdict),
    scores: {
      find,
      understand,
      act,
      protocols: protocolsScore,
      standards_modifier: Math.min(5, standards),
      overall,
    },
    checks_passed: passed,
    checks_total: checkResults.length,
    pages_checked:
      coverage.pages_checked ?? coverage.pagesChecked ?? distinctPages,
    pages_opened_browser:
      coverage.pages_opened_browser ?? coverage.pagesOpenedBrowser ?? 0,
    possible_pages_found:
      coverage.possible_pages_found ??
      coverage.possiblePagesFound ??
      distinctPages,
    sampled_urls: sampledUrls,
    detected_stack: stackParsed.success ? stackParsed.data : "generic",
    categories,
    defects,
    protocols,
    interpretation,
    findings: checkResults.map((check) => ({
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
