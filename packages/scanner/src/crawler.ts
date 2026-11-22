/// <reference path="../../../node_modules/.pnpm/node_modules/@types/node/index.d.ts" />
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
  "/pricing",
  "/about",
  "/contact",
  "/docs",
  "/privacy",
  "/terms",
  "/refunds",
];
const MAX_SAMPLED_PAGES = 5;

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

function collectInternalCandidates(
  origin: string,
  host: string,
  homepage: PageSnapshot,
  sitemapXml: string,
  homepageUrl: string,
): string[] {
  const found = new Set<string>();
  const isInternal = (value: string): boolean => {
    try {
      const parsed = new URL(value, origin);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.host === host
      );
    } catch {
      return false;
    }
  };

  for (const link of homepage.links) {
    if (link.href !== null && isInternal(link.href)) found.add(link.href);
  }
  for (const match of sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const loc = match[1];
    if (loc !== undefined && isInternal(loc)) found.add(loc);
  }

  return Array.from(found)
    .filter((value) => value !== homepageUrl)
    .sort((a, b) => {
      const pathA = new URL(a).pathname.toLowerCase();
      const pathB = new URL(b).pathname.toLowerCase();
      const rankA = PRIORITY_PATHS.findIndex((p) => pathA.includes(p));
      const rankB = PRIORITY_PATHS.findIndex((p) => pathB.includes(p));
      const scoreA = rankA === -1 ? PRIORITY_PATHS.length : rankA;
      const scoreB = rankB === -1 ? PRIORITY_PATHS.length : rankB;
      return scoreA - scoreB || pathA.localeCompare(pathB);
    });
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
  const pages: PageSnapshot[] = [homepage];
  const sampledUrls: string[] = [homepage.url];

  for (const candidate of candidates.slice(0, MAX_SAMPLED_PAGES - 1)) {
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
    pages.push(snapshot);
    sampledUrls.push(snapshot.url);
    if (pages.length >= MAX_SAMPLED_PAGES) break;
  }

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
