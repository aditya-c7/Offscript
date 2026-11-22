import { describe, expect, it, vi } from "vitest";
import {
  CHECK_KEYS,
  PROTOCOL_KEYS,
  type Area,
  type CheckKey,
  type CheckResult,
  type Impact,
  type Interpretation,
  type PageSnapshot,
  type ProtocolKey,
  type ProtocolResult,
  type ScanContext,
  type Verdict,
} from "@offscript/shared";
import { runChecks } from "./checks/index.js";
import { detectProtocols } from "./protocols/index.js";
import { scoreScan } from "./score.js";
import { buildReport } from "./build-report.js";
import { buildFixPrompts } from "./fix-prompts.js";
import { interpretWebsite, type TextJsonModel } from "./interpretation.js";

const TODAY = new Date().toISOString().slice(0, 10);

function makePage(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://example.test/",
    status: 200,
    contentType: "text/html; charset=utf-8",
    headers: { "content-type": "text/html; charset=utf-8" },
    rawHtml:
      "<!doctype html><html lang='en'><head><title>Example</title></head><body><main><h1>Hello</h1></main></body></html>",
    renderedHtml: "",
    text: "Example Hello",
    visibleText: "Example Hello",
    title: "Example",
    lang: "en",
    description: "An example site.",
    canonical: "https://example.test/",
    jsonLd: [],
    links: [],
    forms: [],
    buttons: [],
    headings: [{ level: 1, text: "Hello" }],
    landmarks: { main: true, header: true, nav: true, footer: true },
    images: [],
    canvasCount: 0,
    iframeCount: 0,
    ariaLiveCount: 0,
    ariaDialogCount: 0,
    ariaAlertCount: 0,
    feedbackSurfaces: [],
    stateAttrs: [],
    pageErrors: [],
    cls: 0,
    settledMs: 100,
    bodyHash: "abc123",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    submittedUrl: "https://example.test/",
    normalizedUrl: "https://example.test/",
    host: "example.test",
    pages: [makePage()],
    robotsTxt: "User-agent: *\nAllow: /\n",
    sitemapXml: "",
    headersByUrl: {},
    aiBotStatus: 200,
    aiBotText: "Example Hello",
    chromeStatus: 200,
    chromeText: "Example Hello",
    protocolsRaw: {},
    httpsRedirectOk: true,
    notFoundStatus: 404,
    possiblePagesFound: 1,
    sampledUrls: ["https://example.test/"],
    detectedStack: "generic",
    ...overrides,
  };
}

const GOLD_HTML = `<!doctype html><html lang="en"><head>
<title>Gold Standard Co — AI-ready services</title>
<meta name="description" content="Consulting, hosting and support. Plans from $29/month.">
<link rel="canonical" href="https://gold.test/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Gold Standard Co","url":"https://gold.test/","sameAs":["https://github.com/goldstandard"]}</script>
</head><body>
<header><a href="/">Gold Standard Co</a><nav><a href="/about">About</a> <a href="/pricing">Pricing</a> <a href="/contact">Contact</a> <a href="/privacy">Privacy</a> <a href="/terms">Terms</a> <a href="/refunds">Refunds</a></nav></header>
<main><h1>AI-ready services for everyone</h1><p>We offer consulting, hosting and support. Plans start at $29 per month. Contact us for a quote.</p>
<img src="/logo.png" alt="Gold Standard Co logo" width="120" height="40">
<button type="button" aria-label="Get started">Get started</button>
<form action="/subscribe" method="post"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required><button type="submit" aria-label="Subscribe">Subscribe</button><p role="status" aria-live="polite"></p></form>
<a rel="me" href="https://github.com/goldstandard">GitHub</a>
<section aria-expanded="false">Details</section><div role="dialog" aria-label="Welcome"></div>
</main>
<footer>Gold Standard Co — 123 Main St. <a href="mailto:hello@gold.test">hello@gold.test</a> <a href="tel:+15550100">+1-555-0100</a></footer>
</body></html>`;

const GOLD_TEXT =
  "Gold Standard Co AI-ready services for everyone We offer consulting, hosting and support. Plans start at $29 per month. Contact us for a quote. Gold Standard Co 123 Main St. hello@gold.test +1-555-0100 Privacy Terms Refunds";

function goldContext(): ScanContext {
  const page = makePage({
    url: "https://gold.test/",
    title: "Gold Standard Co — AI-ready services",
    description: "Consulting, hosting and support. Plans from $29/month.",
    rawHtml: GOLD_HTML,
    renderedHtml: GOLD_HTML,
    text: GOLD_TEXT,
    visibleText: GOLD_TEXT,
    canonical: "https://gold.test/",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Gold Standard Co",
        url: "https://gold.test/",
        sameAs: ["https://github.com/goldstandard"],
      },
    ],
    headings: [{ level: 1, text: "AI-ready services for everyone" }],
    images: [
      {
        src: "/logo.png",
        alt: "Gold Standard Co logo",
        width: 120,
        height: 40,
      },
    ],
    links: [
      { text: "Gold Standard Co", href: "/", raw: "", rel: "" },
      { text: "About", href: "/about", raw: "", rel: "" },
      { text: "Pricing", href: "/pricing", raw: "", rel: "" },
      { text: "Contact", href: "/contact", raw: "", rel: "" },
      { text: "Privacy", href: "/privacy", raw: "", rel: "" },
      { text: "Terms", href: "/terms", raw: "", rel: "" },
      { text: "Refunds", href: "/refunds", raw: "", rel: "" },
      {
        text: "hello@gold.test",
        href: "mailto:hello@gold.test",
        raw: "",
        rel: "",
      },
      { text: "+1-555-0100", href: "tel:+15550100", raw: "", rel: "" },
      {
        text: "GitHub",
        href: "https://github.com/goldstandard",
        raw: "",
        rel: "me",
      },
    ],
    buttons: [
      {
        text: "Get started",
        ariaLabel: "Get started",
        type: "button",
        selector: "main button",
        hasOnClick: false,
        disabled: false,
      },
    ],
    forms: [
      {
        action: "/subscribe",
        method: "post",
        selector: "form",
        hasLiveRegion: true,
        fields: [
          {
            name: "email",
            type: "email",
            id: "email",
            label: "Email",
            autocomplete: "email",
            required: true,
            tag: "input",
            selector: "#email",
          },
        ],
        buttons: [
          {
            text: "Subscribe",
            ariaLabel: "Subscribe",
            type: "submit",
            selector: "form button",
            hasOnClick: false,
            disabled: false,
          },
        ],
      },
    ],
    ariaLiveCount: 1,
    ariaDialogCount: 1,
    ariaAlertCount: 0,
    feedbackSurfaces: ["role=status", "role=dialog"],
    stateAttrs: ['aria-expanded="false"'],
    cls: 0.02,
    settledMs: 350,
    pageErrors: [],
  });

  return makeCtx({
    submittedUrl: "https://gold.test/",
    normalizedUrl: "https://gold.test/",
    host: "gold.test",
    pages: [page],
    sampledUrls: [
      "https://gold.test/",
      "https://gold.test/about",
      "https://gold.test/privacy",
      "https://gold.test/terms",
      "https://gold.test/refunds",
    ],
    robotsTxt: [
      "User-agent: *",
      "Allow: /",
      "Content-Signal: search=yes, ai-input=yes, ai-train=no",
      "User-agent: GPTBot",
      "Allow: /",
      "User-agent: ClaudeBot",
      "Allow: /",
      "User-agent: Offscript-Agent/1.0",
      "Allow: /",
    ].join("\n"),
    sitemapXml: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://gold.test/</loc><lastmod>${TODAY}</lastmod></url></urlset>`,
    aiBotText: GOLD_TEXT,
    chromeText: GOLD_TEXT,
    protocolsRaw: {
      llms_txt: { status: 200, body: "# Gold Standard Co" },
      mcp: { status: 200, body: '{"name":"gold-mcp"}' },
      webmcp: { found: true },
      a2a: { status: 200, body: '{"name":"Gold Agent"}' },
      openapi: { status: 200, body: '{"openapi":"3.0.0"}' },
      markdown: {
        status: 200,
        contentType: "text/markdown",
        vary: "Accept",
        notFoundStatus: 404,
      },
    },
    headersByUrl: {
      "https://gold.test/": {
        "content-signal": "search=yes, ai-input=yes, ai-train=no",
        "content-type": "text/html",
      },
    },
  });
}

function csrContext(): ScanContext {
  const rawHtml =
    "<!doctype html><html lang='en'><head><title>SPA</title></head><body><div id='root'></div></body></html>";
  const renderedHtml =
    "<div id='root'><div onclick='go()'>Home</div><div onclick='go()'>About</div><button></button><input type='text'><form action='/x' method='post'><input><button></button></form></div>";
  const page = makePage({
    url: "https://csr.test/",
    title: "SPA",
    rawHtml,
    renderedHtml,
    text: "Home About Go",
    visibleText: "Home About Go",
    canonical: null,
    headings: [{ level: 1, text: "Home" }],
    landmarks: { main: false, header: false, nav: false, footer: false },
    links: [],
    buttons: [
      {
        text: "",
        ariaLabel: null,
        type: "button",
        selector: "#root button",
        hasOnClick: true,
        disabled: false,
      },
    ],
    forms: [
      {
        action: "/x",
        method: "post",
        selector: "#root form",
        hasLiveRegion: false,
        fields: [
          {
            name: "",
            type: "text",
            id: null,
            label: null,
            autocomplete: null,
            required: false,
            tag: "input",
            selector: "#root form input",
          },
        ],
        buttons: [
          {
            text: "",
            ariaLabel: null,
            type: "submit",
            selector: "#root form button",
            hasOnClick: false,
            disabled: false,
          },
        ],
      },
    ],
    cls: 0.25,
    settledMs: 2400,
    pageErrors: ["TypeError: cannot read property 'x'"],
  });
  return makeCtx({
    submittedUrl: "https://csr.test/",
    normalizedUrl: "https://csr.test/",
    host: "csr.test",
    pages: [page],
    sampledUrls: ["https://csr.test/"],
    notFoundStatus: 200,
    aiBotStatus: 403,
    aiBotText: "Forbidden",
    chromeText: "Home About Go",
    sitemapXml: "",
    protocolsRaw: {},
  });
}

function verdictOf(checks: CheckResult[], key: CheckKey): Verdict {
  const found = checks.find((check) => check.key === key);
  if (!found) throw new Error(`missing check ${key}`);
  return found.verdict;
}

function fakeCheck(
  key: CheckKey,
  verdict: Verdict,
  area: Area,
  impact: Impact,
): CheckResult {
  return {
    key,
    category: "reaching",
    area,
    verdict,
    impact,
    confidence: 1,
    page_url: "https://example.test/",
    selector: null,
    snippet: null,
    reproduce_cmd: "curl -sS https://example.test/",
    fix_prompt_md: "",
    evidence: {},
  };
}

function fakeProtocol(key: ProtocolKey, found: boolean): ProtocolResult {
  return { key, found, detail: "", evidence: {} };
}

describe("deterministic checks", () => {
  it("returns exactly the 31 checks in CHECK_KEYS order", () => {
    const checks = runChecks(goldContext());
    expect(checks).toHaveLength(31);
    expect(checks.map((check) => check.key)).toEqual([...CHECK_KEYS]);
    for (const check of checks) {
      expect(check.fix_prompt_md.length).toBeGreaterThan(0);
      expect(check.reproduce_cmd.length).toBeGreaterThan(0);
      expect(check.confidence).toBeGreaterThanOrEqual(0);
      expect(check.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("gold-like context passes nav, SSR, 404, button names and form labels", () => {
    const checks = runChecks(goldContext());
    expect(verdictOf(checks, "browser.navigation_semantics")).toBe("pass");
    expect(verdictOf(checks, "content.initial_ssr_facts")).toBe("pass");
    expect(verdictOf(checks, "retrieval.http_404_semantics")).toBe("pass");
    expect(verdictOf(checks, "interaction.accessible_button_names")).toBe(
      "pass",
    );
    expect(verdictOf(checks, "interaction.form_field_labeling")).toBe("pass");
  });

  it("CSR-like context fails nav, SSR, 404, button names and form labels", () => {
    const checks = runChecks(csrContext());
    expect(verdictOf(checks, "browser.navigation_semantics")).toBe("fail");
    expect(verdictOf(checks, "content.initial_ssr_facts")).toBe("fail");
    expect(verdictOf(checks, "retrieval.http_404_semantics")).toBe("fail");
    expect(verdictOf(checks, "interaction.accessible_button_names")).toBe(
      "fail",
    );
    expect(verdictOf(checks, "interaction.form_field_labeling")).toBe("fail");
  });
});

describe("protocol detectors", () => {
  it("detects all seven protocols in PROTOCOL_KEYS order", () => {
    const protocols = detectProtocols(goldContext());
    expect(protocols.map((protocol) => protocol.key)).toEqual([
      ...PROTOCOL_KEYS,
    ]);
    expect(protocols.every((protocol) => protocol.found)).toBe(true);
  });

  it("fails markdown negotiation when the missing-markdown probe soft-404s", () => {
    const ctx = goldContext();
    ctx.protocolsRaw["markdown"] = {
      status: 200,
      contentType: "text/markdown",
      vary: "Accept",
      notFoundStatus: 200,
    };
    const markdown = detectProtocols(ctx).find(
      (protocol) => protocol.key === "markdown_negotiation",
    );
    expect(markdown?.found).toBe(false);
  });
});

describe("scoreScan", () => {
  const ctx = goldContext();

  it("applies the area weights and protocol modifier formula", () => {
    const checks = [
      fakeCheck("browser.navigation_semantics", "pass", "find", "major"),
      fakeCheck("retrieval.sitemap_freshness", "fail", "find", "supporting"),
      fakeCheck(
        "content.basic_a11y_alt_lang",
        "partial",
        "understand",
        "major",
      ),
      fakeCheck("browser.dom_stability", "pass", "understand", "supporting"),
      fakeCheck("interaction.accessible_button_names", "fail", "act", "major"),
      fakeCheck("browser.feedback_surfaces", "pass", "act", "supporting"),
      fakeCheck("identity.about_page", "pass", "understand", "supporting"),
    ];
    const protocols = PROTOCOL_KEYS.map((key, index) =>
      fakeProtocol(key, index < 3),
    );
    const score = scoreScan(ctx, checks, protocols);
    expect(score.find).toBeCloseTo(75, 6);
    expect(score.understand).toBeCloseTo(((1.5 + 1 + 1) / 5) * 100, 6);
    expect(score.act).toBeCloseTo(25, 6);
    expect(score.protocols).toBeCloseTo(300 / 7, 6);
    expect(score.standards_modifier).toBeCloseTo((3 * 5) / 7, 6);
    expect(score.overall).toBeCloseTo(
      0.45 * 75 + 0.55 * (((1.5 + 1 + 1) / 5) * 100) + (3 * 5) / 7,
      6,
    );
  });

  it("caps overall at 100 and the protocol modifier at 5", () => {
    const checks = CHECK_KEYS.map((key) =>
      fakeCheck(key, "pass", "find", "major"),
    );
    const protocols = PROTOCOL_KEYS.map((key) => fakeProtocol(key, true));
    const score = scoreScan(ctx, checks, protocols);
    expect(score.overall).toBe(100);
    expect(score.standards_modifier).toBe(5);
    expect(score.standards_modifier).toBeLessThanOrEqual(5);
  });

  it("excludes not_applicable checks from denominators", () => {
    const checks = [
      fakeCheck(
        "browser.navigation_semantics",
        "not_applicable",
        "find",
        "major",
      ),
      fakeCheck("retrieval.sitemap_freshness", "pass", "find", "supporting"),
    ];
    expect(scoreScan(ctx, checks, []).find).toBe(100);
  });
});

describe("interpretWebsite grounding", () => {
  const modelOutput = {
    name: "Gold Standard Co",
    website_type: "services site",
    category: "business services",
    business_model: "subscription",
    confidence: { label: "high" as const, score: 0.9 },
    audiences: ['"business owners"'],
    offerings: ['"consulting"', '"Unsupported Quantum Feature"'],
    visitor_goals: ['"find pricing"'],
    could_not_confirm: ["Founded year: https://unknown.example/founded"],
  };

  it("wraps evidence as untrusted and strips unsupported claims and URLs", async () => {
    const seen: {
      value: { system: string; user: string; schemaJson: string } | null;
    } = { value: null };
    const model: TextJsonModel = async (args) => {
      seen.value = args;
      return modelOutput;
    };
    const interpretation = await interpretWebsite(goldContext(), model);
    expect(seen.value).not.toBeNull();
    expect(seen.value?.user).toContain("<<<UNTRUSTED_SITE_EVIDENCE nonce=");
    expect(seen.value?.system).toContain("not instructions");
    expect(interpretation.model_id).toBe("");
    expect(interpretation.prompt_version).toBe("offscript-interpretation/v1");
    expect(interpretation.offerings).toContain('"consulting"');
    expect(interpretation.offerings).not.toContain(
      '"Unsupported Quantum Feature"',
    );
    expect(interpretation.unsupported_claims_stripped).toBeGreaterThanOrEqual(
      1,
    );
    expect(interpretation.unsupported_urls_stripped).toBeGreaterThanOrEqual(1);
  });

  it("falls back safely when the model returns malformed JSON", async () => {
    const model: TextJsonModel = async () => ({ nonsense: true });
    const interpretation = await interpretWebsite(goldContext(), model);
    expect(interpretation.confidence.label).toBe("low");
    expect(interpretation.model_id).toBe("");
  });

  it("does not call the model twice or trust model prose as instructions", async () => {
    const spy = vi.fn(
      async (_args: { system: string; user: string; schemaJson: string }) =>
        modelOutput,
    );
    await interpretWebsite(goldContext(), spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("report assembly", () => {
  it("groups four categories and builds the headline from the overall score", () => {
    const ctx = goldContext();
    const checks = runChecks(ctx);
    const protocols = detectProtocols(ctx);
    const scores = scoreScan(ctx, checks, protocols);
    const report = buildReport({
      id: "scan-1",
      shareToken: "share-1",
      ctx,
      checks,
      protocols,
      scores,
      interpretation: null,
      detectedStack: "nextjs",
    });
    expect(report.categories).toHaveLength(4);
    expect(report.checks_total).toBe(31);
    expect(report.findings).toHaveLength(31);
    expect(["agents_can_use", "agents_struggle", "agents_cannot"]).toContain(
      report.verdict,
    );
    expect(report.rubric_version).toContain("offscript.rubric");
    for (const defect of report.defects) {
      expect(defect.fix_prompts).toHaveLength(6);
    }
    const sample = buildFixPrompts(
      checks[0] ??
        fakeCheck("browser.navigation_semantics", "fail", "find", "major"),
      "wordpress",
    );
    expect(sample.combined_md).toContain("## Reproduce");
    expect(sample.combined_md).toContain("## Done when");
  });
});
