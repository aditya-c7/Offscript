/**
 * Cross-cutting contract tests for the scanner package.
 *
 * These are intentionally written against the public package barrel
 * (`@offscript/shared` types + `@offscript/scanner` functions) so they enforce
 * the same surface the rest of the app consumes. They are fully synthetic and
 * perform no network or LLM calls.
 */
import { describe, expect, it } from "vitest";
import {
  CATEGORY_META,
  CHECK_KEYS,
  CHECK_META,
  CheckResultSchema,
  PIPELINE_VERSION,
  PROTOCOL_KEYS,
  RUBRIC_VERSION,
  STACKS,
  type CheckKey,
  type ScanContext,
  type ScoreBlock,
} from "@offscript/shared";
import {
  buildFixPrompts,
  buildReport,
  detectProtocols,
  runChecks,
  scoreScan,
} from "@offscript/scanner";
import { makeCheck, makeCsrContext, makeGoldContext } from "./factories.js";

const FAILING_CSR_CHECKS: readonly CheckKey[] = [
  "browser.navigation_semantics",
  "content.initial_ssr_facts",
  "retrieval.http_404_semantics",
  "interaction.accessible_button_names",
  "interaction.form_field_labeling",
];

function verdictOf(
  checks: ReadonlyArray<{ key: string; verdict: string }>,
  key: CheckKey,
): string {
  const found = checks.find((check) => check.key === key);
  if (found === undefined) throw new Error(`missing check: ${key}`);
  return found.verdict;
}

describe("runChecks contract", () => {
  it("returns exactly the 31 checks in CHECK_KEYS order, all schema-valid", () => {
    const checks = runChecks(makeGoldContext());

    expect(checks).toHaveLength(31);
    expect(checks.map((check) => check.key)).toEqual([...CHECK_KEYS]);

    for (const key of CHECK_KEYS) {
      const check = checks.find((candidate) => candidate.key === key);
      expect(check, key).toBeDefined();
      if (check === undefined) continue;

      expect(CheckResultSchema.safeParse(check).success).toBe(true);

      const meta = CHECK_META[key];
      expect(check.category).toBe(meta.category);
      expect(check.area).toBe(meta.area);
      expect(check.impact).toBe(meta.impact);

      expect(check.reproduce_cmd.trim().length).toBeGreaterThan(0);
      expect(check.fix_prompt_md.trim().length).toBeGreaterThan(0);
      expect(typeof check.evidence).toBe("object");
      expect(check.evidence).not.toBeNull();
      expect(Object.keys(check.evidence).length).toBeGreaterThan(0);
    }
  });

  it("fails navigation, SSR, 404, button names and form labels on a CSR shell", () => {
    const checks = runChecks(makeCsrContext());
    for (const key of FAILING_CSR_CHECKS) {
      expect(verdictOf(checks, key), key).toBe("fail");
    }
  });
});

describe("detectProtocols contract", () => {
  it("returns seven results in PROTOCOL_KEYS order for the gold site", () => {
    const protocols = detectProtocols(makeGoldContext());
    expect(protocols.map((protocol) => protocol.key)).toEqual([
      ...PROTOCOL_KEYS,
    ]);
    expect(protocols).toHaveLength(7);
    expect(protocols.every((protocol) => protocol.found)).toBe(true);
  });

  it("finds fewer protocols on the CSR shell than on the gold site", () => {
    const goldFound = detectProtocols(makeGoldContext()).filter(
      (protocol) => protocol.found,
    ).length;
    const csrFound = detectProtocols(makeCsrContext()).filter(
      (protocol) => protocol.found,
    ).length;
    expect(goldFound).toBe(7);
    expect(csrFound).toBeLessThan(goldFound);
  });
});

describe("scoreScan contract", () => {
  const gold = makeGoldContext();
  const csr = makeCsrContext();
  const goldScore = scoreScan(gold, runChecks(gold), detectProtocols(gold));
  const csrScore = scoreScan(csr, runChecks(csr), detectProtocols(csr));

  it("scores the healthy site high in all three areas", () => {
    expect(goldScore.find).toBeGreaterThanOrEqual(80);
    expect(goldScore.understand).toBeGreaterThanOrEqual(80);
    expect(goldScore.act).toBeGreaterThanOrEqual(80);
  });

  it("uses the agreed overall formula, with act reported separately", () => {
    const expected = Math.min(
      100,
      0.45 * goldScore.find +
        0.55 * goldScore.understand +
        5 * (goldScore.protocols / 100),
    );
    expect(goldScore.overall).toBeCloseTo(expected, 3);
    expect(typeof goldScore.act).toBe("number");
    expect(goldScore.standards_modifier).toBeLessThanOrEqual(5);
  });

  it("ranks the CSR shell below the healthy site overall", () => {
    expect(csrScore.overall).toBeLessThan(goldScore.overall);
  });
});

describe("buildReport contract", () => {
  function buildFor(
    ctx: ScanContext,
    checks: Parameters<typeof buildReport>[0]["checks"],
    scores: ScoreBlock,
  ) {
    return buildReport({
      id: "scan-contract",
      shareToken: "share-contract",
      ctx,
      checks,
      protocols: detectProtocols(ctx),
      scores,
      interpretation: null,
      detectedStack: ctx.detectedStack,
    });
  }

  it("produces all five sections with category/protocol metadata", () => {
    const ctx = makeGoldContext();
    const checks = runChecks(ctx);
    const report = buildFor(
      ctx,
      checks,
      scoreScan(ctx, checks, detectProtocols(ctx)),
    );

    expect(report.categories).toHaveLength(4);
    expect(report.categories.map((category) => category.title)).toEqual(
      CATEGORY_META.map((meta) => meta.title),
    );
    expect(report.protocols).toHaveLength(7);
    expect(report.findings).toHaveLength(31);
    expect(report.defects).toBeDefined();
    expect(report.scores).toBeDefined();
    expect(report.rubric_version).toBe(RUBRIC_VERSION);
    expect(report.pipeline_version).toBe(PIPELINE_VERSION);
  });

  it("ranks high-priority defects before important ones", () => {
    const ctx = makeGoldContext();
    const checks = [
      makeCheck("identity.returns_refunds", "fail", "supporting"),
      makeCheck("browser.navigation_semantics", "fail", "major"),
      makeCheck("identity.about_page", "partial", "supporting"),
      makeCheck("retrieval.http_404_semantics", "partial", "major"),
    ];
    const report = buildFor(ctx, checks, scoreScan(ctx, checks, []));
    const priorities = report.defects.map((defect) => defect.priority);
    expect(priorities).toEqual(["high", "high", "important", "important"]);
  });

  it("uses the agreed headline copy for each verdict band", () => {
    const ctx = makeGoldContext();
    const checks = runChecks(ctx);
    const scores = scoreScan(ctx, checks, detectProtocols(ctx));

    const good = buildFor(ctx, checks, scores);
    expect(good.verdict).toBe("agents_can_use");
    expect(good.headline).toBe("Agents can use this site");

    const struggling = buildFor(ctx, checks, {
      ...scores,
      overall: 65,
    });
    expect(struggling.verdict).toBe("agents_struggle");
    expect(struggling.headline).toBe(
      "Agents will struggle with parts of this site",
    );

    const broken = buildFor(ctx, checks, { ...scores, overall: 25 });
    expect(broken.verdict).toBe("agents_cannot");
    expect(broken.headline).toBe("Agents cannot reliably use this site");
  });
});

describe("buildFixPrompts contract", () => {
  const check = runChecks(makeGoldContext())[0];
  if (check === undefined) throw new Error("gold runChecks returned no checks");

  const REQUIRED_SECTIONS: readonly string[] = [
    "## Reproduce",
    "## Observed",
    "## Why it matters",
    "## Where to look",
    "## Fix",
    "## Do not",
    "## Stop and ask",
    "## Done when",
  ];

  it("emits every required section for each of the six stacks", () => {
    expect(STACKS).toHaveLength(6);
    for (const stack of STACKS) {
      const prompt = buildFixPrompts(check, stack.key);
      for (const section of REQUIRED_SECTIONS) {
        expect(prompt.combined_md, `${stack.key}: ${section}`).toContain(
          section,
        );
      }
      expect(prompt.combined_md).toContain(check.key);
      expect(prompt.stack).toBe(stack.key);
    }
  });
});
