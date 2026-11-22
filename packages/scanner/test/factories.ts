/**
 * Synthetic, network-free ScanContext factories for the scanner contract tests.
 *
 * `makeGoldContext` is a deliberately "healthy" site that satisfies all 31
 * deterministic checks and exposes all seven agent protocols. `makeCsrContext`
 * is a client-rendered shell that fails the navigation / SSR / 404 / button /
 * form-label checks. `makeCheck` builds a minimal, schema-valid CheckResult for
 * exercising the scorer and report builder in isolation.
 */
import {
  CHECK_META,
  type ButtonInfo,
  type CheckKey,
  type CheckResult,
  type FieldInfo,
  type FormInfo,
  type Impact,
  type LinkInfo,
  type PageSnapshot,
  type ScanContext,
  type Verdict,
} from "@offscript/shared";

const GOLD_HOST = "gold.test";
const GOLD_ORIGIN = `https://${GOLD_HOST}`;
const GOLD_OPERATOR = "Gold Standard Co";
const GOLD_BODY =
  "We offer consulting, hosting and support. Plans start at $29 per month.";
const GOLD_LINKS: readonly LinkInfo[] = [
  { text: "Home", href: "/", raw: "/", rel: "" },
  { text: "About", href: "/about", raw: "/about", rel: "" },
  { text: "Pricing", href: "/pricing", raw: "/pricing", rel: "" },
  { text: "Contact", href: "/contact", raw: "/contact", rel: "" },
  { text: "Privacy", href: "/privacy", raw: "/privacy", rel: "" },
  { text: "Terms", href: "/terms", raw: "/terms", rel: "" },
  { text: "Returns", href: "/returns", raw: "/returns", rel: "" },
  {
    text: "GitHub",
    href: "https://github.com/goldstandard",
    raw: "https://github.com/goldstandard",
    rel: "me",
  },
  {
    text: "hello@gold.test",
    href: "mailto:hello@gold.test",
    raw: "mailto:hello@gold.test",
    rel: "",
  },
  { text: "+1-555-0100", href: "tel:+15550100", raw: "tel:+15550100", rel: "" },
];

function goldButton(text: string, selector: string): ButtonInfo {
  return {
    text,
    ariaLabel: text.length > 0 ? text : null,
    type: "button",
    selector,
    hasOnClick: false,
    disabled: false,
  };
}

function goldForm(): FormInfo {
  const field: FieldInfo = {
    name: "email",
    type: "email",
    id: "email",
    label: "Email",
    autocomplete: "email",
    required: true,
    tag: "input",
    selector: "#email",
  };
  const submit: ButtonInfo = {
    text: "Subscribe",
    ariaLabel: "Subscribe",
    type: "submit",
    selector: "form button",
    hasOnClick: false,
    disabled: false,
  };
  return {
    action: "/subscribe",
    method: "post",
    fields: [field],
    buttons: [submit],
    hasLiveRegion: true,
    selector: "form",
  };
}

function goldJsonLd(url: string): unknown[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: GOLD_OPERATOR,
      url,
      sameAs: ["https://github.com/goldstandard"],
    },
  ];
}

function goldHtml(args: {
  title: string;
  h1: string;
  body: string;
  canonical: string;
  jsonLd: unknown[];
}): string {
  return [
    '<!doctype html><html lang="en"><head>',
    `<title>${args.title}</title>`,
    `<meta name="description" content="${args.body}">`,
    `<link rel="canonical" href="${args.canonical}">`,
    `<script type="application/ld+json">${JSON.stringify(args.jsonLd)}</script>`,
    "</head><body>",
    "<header><nav>",
    '<a href="/">Home</a>',
    '<a href="/about">About</a>',
    '<a href="/pricing">Pricing</a>',
    '<a href="/contact">Contact</a>',
    '<a href="/privacy">Privacy</a>',
    '<a href="/terms">Terms</a>',
    '<a href="/returns">Returns</a>',
    '<a rel="me" href="https://github.com/goldstandard">GitHub</a>',
    "</nav></header>",
    `<main><h1>${args.h1}</h1><p>${args.body}</p>`,
    `<img src="/logo.png" alt="${GOLD_OPERATOR} logo" width="120" height="40">`,
    '<button type="button" aria-label="Get started">Get started</button>',
    '<form action="/subscribe" method="post">',
    '<label for="email">Email</label>',
    '<input id="email" name="email" type="email" autocomplete="email" required>',
    '<button type="submit" aria-label="Subscribe">Subscribe</button>',
    '<p role="status" aria-live="polite"></p></form>',
    "</main>",
    `<footer>${GOLD_OPERATOR} <a href="mailto:hello@gold.test">hello@gold.test</a> <a href="tel:+15550100">+1-555-0100</a></footer>`,
    "</body></html>",
  ].join("\n");
}

function makeGoldSitePage(
  pathname: string,
  title: string,
  h1: string,
  body: string,
): PageSnapshot {
  const url = `${GOLD_ORIGIN}${pathname}`;
  const jsonLd = goldJsonLd(url);
  const html = goldHtml({ title, h1, body, canonical: url, jsonLd });
  // Every token of visibleText is present verbatim in rawHtml, so the SSR
  // fact check sees a fully server-rendered page.
  const visibleText = [
    title,
    h1,
    body,
    GOLD_OPERATOR,
    "About Pricing Contact Privacy Terms Returns GitHub",
    "hello@gold.test +1-555-0100",
  ].join("\n");
  return {
    url,
    status: 200,
    contentType: "text/html; charset=utf-8",
    headers: { "content-type": "text/html; charset=utf-8" },
    rawHtml: html,
    renderedHtml: html,
    text: visibleText,
    visibleText,
    title,
    lang: "en",
    description: body,
    canonical: url,
    jsonLd,
    links: [...GOLD_LINKS],
    forms: [goldForm()],
    buttons: [goldButton("Get started", "main button")],
    headings: [{ level: 1, text: h1 }],
    landmarks: { main: true, header: true, nav: true, footer: true },
    images: [
      {
        src: "/logo.png",
        alt: `${GOLD_OPERATOR} logo`,
        width: 120,
        height: 40,
      },
    ],
    canvasCount: 0,
    iframeCount: 0,
    ariaLiveCount: 1,
    ariaDialogCount: 1,
    ariaAlertCount: 0,
    feedbackSurfaces: ["confirmation dialog", "role=status"],
    stateAttrs: ['aria-expanded="false"'],
    pageErrors: [],
    cls: 0.02,
    settledMs: 300,
    bodyHash: `gold${pathname.replace(/[^a-z0-9]/gi, "")}`,
  };
}

/** A healthy site: all 31 checks pass and all seven protocols are found. */
export function makeGoldContext(): ScanContext {
  const primaryText = [
    "Gold Standard Co - AI-ready services",
    "AI-ready services for everyone",
    GOLD_BODY,
    GOLD_OPERATOR,
    "About Pricing Contact Privacy Terms Returns GitHub",
    "hello@gold.test +1-555-0100",
  ].join("\n");
  const today = new Date().toISOString().slice(0, 10);
  const robots = [
    "User-agent: *",
    "Allow: /",
    "Content-Signal: search=yes, ai-input=yes, ai-train=no",
    "User-agent: GPTBot",
    "Allow: /",
    "User-agent: ClaudeBot",
    "Allow: /",
    "User-agent: Offscript-Agent/1.0",
    "Allow: /",
  ].join("\n");
  return {
    submittedUrl: `${GOLD_ORIGIN}/`,
    normalizedUrl: `${GOLD_ORIGIN}/`,
    host: GOLD_HOST,
    pages: [
      makeGoldSitePage(
        "/",
        "Gold Standard Co - AI-ready services",
        "AI-ready services for everyone",
        GOLD_BODY,
      ),
      makeGoldSitePage(
        "/about",
        "About Gold Standard Co",
        "About us",
        "We are a consulting and hosting company.",
      ),
      makeGoldSitePage(
        "/pricing",
        "Pricing - Gold Standard Co",
        "Simple pricing",
        "Plans start at $29 per month.",
      ),
      makeGoldSitePage(
        "/contact",
        "Contact - Gold Standard Co",
        "Contact us",
        "Email us or call us.",
      ),
      makeGoldSitePage(
        "/privacy",
        "Privacy - Gold Standard Co",
        "Privacy policy",
        "We respect your privacy.",
      ),
      makeGoldSitePage(
        "/terms",
        "Terms - Gold Standard Co",
        "Terms of service",
        "These are the terms of use.",
      ),
      makeGoldSitePage(
        "/returns",
        "Returns - Gold Standard Co",
        "Returns and refunds",
        "We offer refunds within 30 days.",
      ),
    ],
    robotsTxt: robots,
    sitemapXml:
      '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      `<url><loc>${GOLD_ORIGIN}/</loc><lastmod>${today}</lastmod></url>` +
      "</urlset>",
    headersByUrl: {
      [`${GOLD_ORIGIN}/`]: {
        "content-signal": "search=yes, ai-input=yes, ai-train=no",
        "content-type": "text/html",
      },
    },
    aiBotStatus: 200,
    aiBotText: primaryText,
    chromeStatus: 200,
    chromeText: primaryText,
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
    httpsRedirectOk: true,
    notFoundStatus: 404,
    possiblePagesFound: 7,
    sampledUrls: [
      `${GOLD_ORIGIN}/`,
      `${GOLD_ORIGIN}/about`,
      `${GOLD_ORIGIN}/pricing`,
      `${GOLD_ORIGIN}/privacy`,
      `${GOLD_ORIGIN}/terms`,
      `${GOLD_ORIGIN}/returns`,
    ],
    detectedStack: "nextjs",
  };
}

/** A client-rendered shell that fails navigation, SSR, 404, buttons and labels. */
export function makeCsrContext(): ScanContext {
  const rawHtml =
    "<!doctype html><html lang='en'><head><title>SPA</title></head><body><div id='root'></div></body></html>";
  const renderedHtml =
    "<div id='root'><div onclick='go()'>Home</div><div onclick='go()'>About</div>" +
    "<button></button><input type='text'>" +
    "<form action='/x' method='post'><input><button></button></form></div>";
  const text = "Home About";
  const page: PageSnapshot = {
    url: "https://csr.test/",
    status: 200,
    contentType: "text/html; charset=utf-8",
    headers: { "content-type": "text/html; charset=utf-8" },
    rawHtml,
    renderedHtml,
    text,
    visibleText: text,
    title: "SPA",
    lang: "en",
    description: null,
    canonical: null,
    jsonLd: [],
    links: [],
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
    headings: [{ level: 1, text: "Home" }],
    landmarks: { main: false, header: false, nav: false, footer: false },
    images: [],
    canvasCount: 0,
    iframeCount: 0,
    ariaLiveCount: 0,
    ariaDialogCount: 0,
    ariaAlertCount: 0,
    feedbackSurfaces: [],
    stateAttrs: [],
    pageErrors: ["TypeError: cannot read property 'x'"],
    cls: 0.25,
    settledMs: 2400,
    bodyHash: "csrhash",
  };
  return {
    submittedUrl: "https://csr.test/",
    normalizedUrl: "https://csr.test/",
    host: "csr.test",
    pages: [page],
    robotsTxt: "",
    sitemapXml: "",
    headersByUrl: {},
    aiBotStatus: 403,
    aiBotText: "Forbidden",
    chromeStatus: 200,
    chromeText: text,
    protocolsRaw: {},
    httpsRedirectOk: false,
    notFoundStatus: 200,
    possiblePagesFound: 1,
    sampledUrls: ["https://csr.test/"],
    detectedStack: "generic",
  };
}

/** A minimal, schema-valid CheckResult for scorer / report unit tests. */
export function makeCheck(
  key: CheckKey,
  verdict: Verdict,
  impact: Impact,
): CheckResult {
  const meta = CHECK_META[key];
  return {
    key,
    category: meta.category,
    area: meta.area,
    verdict,
    impact,
    confidence: 1,
    page_url: `${GOLD_ORIGIN}/`,
    selector: null,
    snippet: null,
    reproduce_cmd: `curl -sSL ${GOLD_ORIGIN}/`,
    fix_prompt_md: `# Fix ${meta.title}\n\nSee the affected page and apply the standard semantics.`,
    evidence: { synthetic: true, check_key: key },
  };
}
