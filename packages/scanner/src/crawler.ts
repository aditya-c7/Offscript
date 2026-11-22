import type { Browser } from "playwright";
import { normalizeUrl } from "@offscript/shared";
import type { PageSnapshot, ScanContext, Stack } from "@offscript/shared";
import { loadPage } from "./browser.js";
import { safeFetch } from "./http-client.js";
import type { SafeFetchResponse } from "./http-client.js";
import { assertSafeUrl } from "./ssrf.js";

const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PRIORITY_PATHS = [
  "/ai",
  "/pricing",
  "/about",
  "/contact",
  "/docs",
  "/privacy",
  "/terms",
  "/refunds",
];
const MAX_SAMPLED_PAGES = 5;
// Below this many discovered internal pages, probe the standard paths so a
// client-rendered site still exposes its identity and legal pages.
const FEW_CANDIDATES = 3;

const EMPTY_RESPONSE: SafeFetchResponse = {
  status: 0,
  headers: {},
  text: "",
  url: "",
  contentType: "",
};

async function attempt<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function recordHeaders(
  target: Record<string, Record<string, string>>,
  requested: string,
  response: SafeFetchResponse,
): void {
  target[requested] = response.headers;
  if (response.url.length > 0) target[response.url] = response.headers;
}

function randomPath(extension: string): string {
  return `/__offscript_probe_${Math.random().toString(36).slice(2)}${extension}`;
}

/**
 * Canonical key used to dedupe discovered candidates and sampled pages.
 * Ignores trailing slashes, fragments and the cosmetic `www.` prefix so a
 * homepage reached after a redirect is not sampled a second time.
 */
export function normalizedUrlKey(value: string): string {
  try {
    const url = new URL(value);
    const host = url.host.replace(/^www\./i, "");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${host}${pathname}${url.search}`;
  } catch {
    return (
      value
        .trim()
        .replace(/^www\./i, "")
        .replace(/\/+$/, "") || "/"
    );
  }
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'");
}

/** Pull every `<a href>` value out of a raw or rendered HTML document. */
export function extractHtmlHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const anchor = /<a\b[^>]*>/gi;
  const attribute = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
  for (const tag of html.matchAll(anchor)) {
    const match = attribute.exec(tag[0]);
    const raw = match?.[1] ?? match?.[2] ?? match?.[3];
    if (raw === undefined) continue;
    hrefs.push(decodeHtmlAttribute(raw.trim()));
  }
  return hrefs;
}

function isCandidateHref(raw: string): boolean {
  const value = raw.trim();
  return (
    value.length > 0 && !/^(?:#|javascript:|mailto:|tel:|data:)/i.test(value)
  );
}

function emptySnapshot(url: string, response: SafeFetchResponse): PageSnapshot {
  return {
    url: response.url || url,
    status: response.status,
    contentType: response.contentType,
    headers: response.headers,
    rawHtml: response.text,
    renderedHtml: response.text,
    text: "",
    visibleText: "",
    title: "",
    lang: null,
    description: null,
    canonical: null,
    jsonLd: [],
    links: [],
    forms: [],
    buttons: [],
    headings: [],
    landmarks: { main: false, header: false, nav: false, footer: false },
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
    settledMs: 0,
    bodyHash: "",
  };
}

function detectStack(headers: Record<string, string>, html: string): Stack {
  const headerText = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")
    .toLowerCase();
  const page = html.toLowerCase();
  if (
    page.includes("__next_data__") ||
    headerText.includes("next.js") ||
    headerText.includes("x-nextjs")
  ) {
    return "nextjs";
  }
  if (page.includes("cdn.shopify") || page.includes("shopify"))
    return "shopify";
  if (page.includes("webflow")) return "webflow";
  if (page.includes("wp-content") || page.includes("wordpress")) {
    return "wordpress";
  }
  if (page.includes("wix") || page.includes("squarespace")) return "builder";
  return "generic";
}

function priorityRank(value: string): number {
  let pathname = value;
  try {
    pathname = new URL(value).pathname.toLowerCase();
  } catch {
    pathname = value.toLowerCase();
  }
  const rank = PRIORITY_PATHS.findIndex(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  return rank === -1 ? PRIORITY_PATHS.length : rank;
}

/** Rank and dedupe internal candidates, putting standard paths first. */
export function rankCandidates(
  candidates: ReadonlySet<string>,
  homepageUrl: string,
): string[] {
  const homeKey = normalizedUrlKey(homepageUrl);
  return Array.from(candidates)
    .filter((value) => normalizedUrlKey(value) !== homeKey)
    .sort(
      (a, b) =>
        priorityRank(a) - priorityRank(b) ||
        normalizedUrlKey(a).localeCompare(normalizedUrlKey(b)),
    );
}

/**
 * Build the deduplicated set of internal pages to sample. Server HTML, the
 * post-JS DOM and the sitemap are all consulted so CSR sites that only expose
 * links in one of those surfaces are still discovered.
 */
export function collectInternalCandidates(
  origin: string,
  host: string,
  homepage: PageSnapshot,
  sitemapXml: string,
  homepageUrl: string,
): string[] {
  const byKey = new Map<string, string>();
  const allowedHosts = new Set<string>([host, `www.${host}`]);
  try {
    allowedHosts.add(new URL(homepageUrl).host);
  } catch {
    // Keep the hosts derived from the normalized input.
  }
  const isInternal = (value: string): boolean => {
    try {
      const parsed = new URL(value, origin);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        allowedHosts.has(parsed.host)
      );
    } catch {
      return false;
    }
  };
  const add = (raw: string): void => {
    if (!isCandidateHref(raw)) return;
    try {
      const resolved = new URL(raw, origin);
      if (!isInternal(resolved.toString())) return;
      resolved.hash = "";
      const href = resolved.toString();
      const key = normalizedUrlKey(href);
      if (!byKey.has(key)) byKey.set(key, href);
    } catch {
      // Ignore malformed links; they are not safe to navigate to.
    }
  };

  for (const link of homepage.links) {
    if (link.href !== null) add(link.href);
  }
  for (const href of extractHtmlHrefs(homepage.rawHtml)) add(href);
  for (const href of extractHtmlHrefs(homepage.renderedHtml)) add(href);
  for (const match of sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const loc = match[1];
    if (loc !== undefined) add(loc);
  }

  return rankCandidates(new Set(byKey.values()), homepageUrl);
}

/**
 * Final guard for `sampled_urls`: redirects can make two different requested
 * URLs resolve to the same document, so collapse them by canonical key.
 */
export function dedupeSampled(snapshots: readonly PageSnapshot[]): {
  pages: PageSnapshot[];
  sampledUrls: string[];
} {
  const pages: PageSnapshot[] = [];
  const sampledUrls: string[] = [];
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    const key = normalizedUrlKey(snapshot.url);
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push(snapshot);
    sampledUrls.push(snapshot.url);
  }
  return { pages, sampledUrls };
}

/** Standard paths to probe directly when few internal links were discovered. */
export function planPriorityProbes(
  candidates: readonly string[],
  origin: string,
): string[] {
  if (candidates.length >= FEW_CANDIDATES) return [];
  const known = new Set(candidates.map((value) => normalizedUrlKey(value)));
  const probes: string[] = [];
  for (const path of PRIORITY_PATHS) {
    const url = new URL(path, origin).toString();
    const key = normalizedUrlKey(url);
    if (known.has(key)) continue;
    known.add(key);
    probes.push(url);
  }
  return probes;
}

/**
 * Collect every observation the 31 checks consume: retrieval probes, protocol
 * probes, browser snapshots and stack detection. Individual sub-request
 * failures are recorded as empty and never abort the whole scan.
 */
export async function crawlSite(
  rawUrl: string,
  browser: Browser,
): Promise<ScanContext> {
  const normalized = normalizeUrl(rawUrl);
  const origin = new URL(normalized.url.toString()).origin;
  const headersByUrl: Record<string, Record<string, string>> = {};
  const protocolsRaw: Record<string, unknown> = {};

  const robotsUrl = new URL("/robots.txt", origin).toString();
  const sitemapUrl = new URL("/sitemap.xml", origin).toString();

  const robots = await attempt(() => safeFetch(robotsUrl), EMPTY_RESPONSE);
  const sitemap = await attempt(() => safeFetch(sitemapUrl), EMPTY_RESPONSE);
  const homepageFetch = await attempt(
    () => safeFetch(normalized.href),
    EMPTY_RESPONSE,
  );
  recordHeaders(headersByUrl, robotsUrl, robots);
  recordHeaders(headersByUrl, sitemapUrl, sitemap);
  recordHeaders(headersByUrl, normalized.href, homepageFetch);

  const notFoundUrl = new URL(randomPath(""), origin).toString();
  const notFound = await attempt(() => safeFetch(notFoundUrl), EMPTY_RESPONSE);
  recordHeaders(headersByUrl, notFoundUrl, notFound);

  const aiBot = await attempt(
    () =>
      safeFetch(normalized.href, {
        headers: { "user-agent": "Offscript-Agent/1.0" },
      }),
    EMPTY_RESPONSE,
  );
  const chrome = await attempt(
    () =>
      safeFetch(normalized.href, {
        headers: { "user-agent": CHROME_USER_AGENT },
      }),
    EMPTY_RESPONSE,
  );
  recordHeaders(headersByUrl, normalized.href, aiBot);
  recordHeaders(headersByUrl, normalized.href, chrome);

  const httpUrl = new URL(normalized.url.toString());
  httpUrl.protocol = "http:";
  if (httpUrl.port === "443") httpUrl.port = "";
  const httpVariant = await attempt(
    () => safeFetch(httpUrl.toString()),
    EMPTY_RESPONSE,
  );
  recordHeaders(headersByUrl, httpUrl.toString(), httpVariant);
  const httpsRedirectOk =
    normalized.protocol === "https:"
      ? httpVariant.status >= 200 &&
        httpVariant.status < 400 &&
        httpVariant.url.startsWith("https://")
      : httpVariant.url.startsWith("https://");

  const protocolProbes: Array<[string, string, boolean]> = [
    ["llms_txt", "/llms.txt", false],
    ["mcp", "/.well-known/mcp/server-card.json", true],
    ["a2a", "/.well-known/agent-card.json", true],
    ["openapi", "/openapi.json", true],
  ];
  for (const [key, path, isJson] of protocolProbes) {
    const probeUrl = new URL(path, origin).toString();
    const response = await attempt(() => safeFetch(probeUrl), EMPTY_RESPONSE);
    recordHeaders(headersByUrl, probeUrl, response);
    let parsed: unknown = null;
    if (isJson && response.text.trim().length > 0) {
      try {
        const value: unknown = JSON.parse(response.text);
        parsed = value;
      } catch {
        parsed = null;
      }
    }
    protocolsRaw[key] = {
      status: response.status,
      body: response.text,
      url: response.url,
      ...(isJson ? { json: parsed } : {}),
    };
  }

  const markdown = await attempt(
    () => safeFetch(normalized.href, { headers: { accept: "text/markdown" } }),
    EMPTY_RESPONSE,
  );
  const markdownMissing = await attempt(
    () => safeFetch(new URL(randomPath(".md"), origin).toString()),
    EMPTY_RESPONSE,
  );
  protocolsRaw["markdown_negotiation"] = {
    status: markdown.status,
    contentType: markdown.contentType,
    vary: markdown.headers["vary"] ?? "",
    notFoundStatus: markdownMissing.status,
    body: markdown.text,
  };

  // The homepage is always sampled first.
  const homepage = await attempt(
    () => loadPage(browser, normalized.href),
    emptySnapshot(normalized.href, homepageFetch),
  );

  const candidates = collectInternalCandidates(
    origin,
    normalized.host,
    homepage,
    sitemap.text,
    homepage.url,
  );
  // Client-rendered sites often expose no usable links in the initial HTML.
  // Probe the standard paths directly so identity and legal pages are still
  // checked instead of silently skipping every page after the homepage.
  for (const probeUrl of planPriorityProbes(candidates, origin)) {
    const probe = await attempt<SafeFetchResponse | null>(
      () => safeFetch(probeUrl, { timeoutMs: 5_000 }),
      null,
    );
    if (probe !== null && probe.status === 200) {
      const key = normalizedUrlKey(probeUrl);
      if (!candidates.some((value) => normalizedUrlKey(value) === key)) {
        candidates.push(probeUrl);
      }
    }
  }

  const snapshots: PageSnapshot[] = [homepage];
  for (const candidate of candidates) {
    const candidateKey = normalizedUrlKey(candidate);
    if (
      snapshots.some(
        (snapshot) => normalizedUrlKey(snapshot.url) === candidateKey,
      )
    ) {
      continue;
    }
    const safe = await attempt<{ url: URL; ip: string } | null>(
      () => assertSafeUrl(candidate),
      null,
    );
    if (safe === null) continue;
    const snapshot = await attempt<PageSnapshot | null>(
      () => loadPage(browser, safe.url.href),
      null,
    );
    if (snapshot === null) continue;
    snapshots.push(snapshot);
    if (dedupeSampled(snapshots).pages.length >= MAX_SAMPLED_PAGES) break;
  }
  const { pages, sampledUrls } = dedupeSampled(snapshots);

  const headers = homepage.headers;
  const html = `${homepage.rawHtml}\n${homepage.renderedHtml}`;

  return {
    submittedUrl: rawUrl,
    normalizedUrl: normalized.href,
    host: normalized.host,
    pages,
    robotsTxt: robots.text,
    sitemapXml: sitemap.text,
    headersByUrl,
    aiBotStatus: aiBot.status,
    aiBotText: aiBot.text,
    chromeStatus: chrome.status,
    chromeText: chrome.text,
    protocolsRaw,
    httpsRedirectOk,
    notFoundStatus: notFound.status,
    possiblePagesFound: candidates.length,
    sampledUrls,
    detectedStack: detectStack(headers, html),
  };
}
