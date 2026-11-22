/** Deterministic checks for reaching and fetching the site. */
import type { PageSnapshot, ScanContext } from "@offscript/shared";
import {
  hostnameOf,
  htmlPages,
  makeCheck,
  ratio,
  similarity,
  unique,
} from "./util.js";

const AI_AGENTS: ReadonlyArray<{ name: string; aliases: readonly string[] }> = [
  { name: "GPTBot", aliases: ["GPTBot"] },
  { name: "ClaudeBot", aliases: ["ClaudeBot"] },
  { name: "Offscript-Agent", aliases: ["Offscript-Agent", "OffscriptAgent"] },
];

interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || current.allow.length > 0 || current.disallow.length > 0) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      if (field === "allow" && value.length > 0) current.allow.push(value);
      if (field === "disallow" && value.length > 0)
        current.disallow.push(value);
    }
  }
  return groups;
}

function agentAllowance(
  groups: RobotsGroup[],
  aliases: readonly string[],
): { allowed: boolean; source: string } {
  const lowered = aliases.map((alias) => alias.toLowerCase());
  const specific = groups.find((group) =>
    group.agents.some(
      (agent) =>
        agent !== "*" &&
        lowered.some(
          (alias) =>
            agent === alias ||
            alias.startsWith(agent) ||
            agent.startsWith(alias),
        ),
    ),
  );
  const effective =
    specific ?? groups.find((group) => group.agents.includes("*"));
  if (!effective) return { allowed: true, source: "default-allow" };
  const rootDisallow = effective.disallow.some(
    (value) => value === "/" || value === "/*",
  );
  const rootAllow = effective.allow.some(
    (value) => value === "/" || value === "/*",
  );
  return {
    allowed: !rootDisallow && (rootAllow || effective.allow.length === 0),
    source: specific ? "agent-specific" : "wildcard",
  };
}

export function checkSitemapFreshness(ctx: ScanContext) {
  const xml = ctx.sitemapXml.trim();
  const hasUrlSet = /<urlset[\s>]/i.test(xml);
  const locCount = (xml.match(/<loc\s*>/gi) ?? []).length;
  const lastmods = [...xml.matchAll(/<lastmod\s*>([^<]+)<\/lastmod\s*>/gi)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
  const timestamps = lastmods
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  const now = Date.now();
  const ages = timestamps.map((stamp) =>
    Math.max(0, (now - stamp) / 86_400_000),
  );
  const newestAge = ages.length > 0 ? Math.min(...ages) : null;
  const valid = hasUrlSet && locCount > 0;
  const fresh = newestAge !== null && newestAge <= 365;
  const verdict = !valid ? "fail" : fresh ? "pass" : "partial";
  return makeCheck(ctx, "retrieval.sitemap_freshness", {
    verdict,
    confidence: valid ? 0.92 : 0.99,
    evidence: {
      present: xml.length > 0,
      valid_xml: valid,
      url_count: locCount,
      lastmod_count: lastmods.length,
      lastmod: lastmods[0] ?? null,
      newest_age_days: newestAge,
      fresh,
    },
    snippet: xml.slice(0, 500) || null,
  });
}

export function checkCanonicalUrls(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  let https = 0;
  let http = 0;
  let relative = 0;
  let missing = 0;
  let wrongHost = 0;
  for (const page of pages) {
    const canonical = page.canonical?.trim() ?? "";
    if (canonical.length === 0) {
      missing += 1;
      continue;
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(canonical)) {
      relative += 1;
      continue;
    }
    if (/^https:\/\//i.test(canonical)) {
      https += 1;
      if (
        hostnameOf(canonical) !== hostnameOf(page.url) &&
        hostnameOf(canonical) !== hostnameOf(ctx.normalizedUrl)
      ) {
        wrongHost += 1;
      }
    } else if (/^http:\/\//i.test(canonical)) {
      http += 1;
    } else {
      relative += 1;
    }
  }
  const good = https - wrongHost;
  const coverage = ratio(good, pages.length);
  const verdict =
    pages.length === 0
      ? "fail"
      : coverage >= 0.999
        ? "pass"
        : good > 0 || http > 0
          ? "partial"
          : "fail";
  return makeCheck(ctx, "retrieval.canonical_urls", {
    verdict,
    confidence: 0.94,
    evidence: {
      pages_checked: pages.length,
      absolute_https: https,
      absolute_http: http,
      relative: relative,
      missing,
      wrong_host: wrongHost,
      good_coverage: coverage,
    },
    snippet: pages[0]?.canonical ?? null,
  });
}

export function checkHttp404Semantics(ctx: ScanContext) {
  const status = ctx.notFoundStatus;
  const verdict =
    status === 404 || status === 410
      ? "pass"
      : status === 200
        ? "fail"
        : "partial";
  return makeCheck(ctx, "retrieval.http_404_semantics", {
    verdict,
    confidence: 0.99,
    evidence: {
      not_found_status: status,
      soft_404: status === 200,
      expected: [404, 410],
    },
    snippet: `GET ${ctx.normalizedUrl.replace(/\/$/, "")}/__offscript_nonexistent__ -> ${status}`,
  });
}

export function checkHttpsEnforcement(ctx: ScanContext) {
  const ok = ctx.httpsRedirectOk === true;
  return makeCheck(ctx, "retrieval.https_enforcement", {
    verdict: ok ? "pass" : "fail",
    confidence: 0.97,
    evidence: { https_redirect_ok: ok, normalized_url: ctx.normalizedUrl },
  });
}

const INTERSTITIAL =
  /(access denied|forbidden|captcha|are you a robot|verify you are human|unusual traffic|enable javascript|request blocked|bot detected|attention required|security check)/i;

export function checkAiBotHttpAccess(ctx: ScanContext) {
  const text = ctx.aiBotText ?? "";
  const interstitialHit = text.match(INTERSTITIAL)?.[0] ?? null;
  const status = ctx.aiBotStatus;
  const verdict =
    status === 200 && interstitialHit === null && text.trim().length > 0
      ? "pass"
      : status === 200
        ? "partial"
        : "fail";
  return makeCheck(ctx, "retrieval.ai_bot_http_access", {
    verdict,
    confidence: 0.96,
    evidence: {
      ai_bot_status: status,
      body_chars: text.length,
      interstitial_match: interstitialHit,
      chrome_status: ctx.chromeStatus,
    },
    snippet: text.slice(0, 400) || null,
  });
}

export function checkRobotsUserActingAgents(ctx: ScanContext) {
  const groups = parseRobots(ctx.robotsTxt ?? "");
  const details = AI_AGENTS.map((agent) => {
    const result = agentAllowance(groups, agent.aliases);
    return {
      agent: agent.name,
      allowed: result.allowed,
      source: result.source,
    };
  });
  const allowed = details.filter((item) => item.allowed).length;
  const verdict =
    allowed === details.length ? "pass" : allowed > 0 ? "partial" : "fail";
  return makeCheck(ctx, "retrieval.robots_user_acting_agents", {
    verdict,
    confidence: 0.9,
    evidence: {
      groups_found: groups.length,
      agents_checked: details,
      allowed_count: allowed,
      has_content_signal: /content-signal/i.test(ctx.robotsTxt ?? ""),
    },
    snippet: (ctx.robotsTxt ?? "").slice(0, 500) || null,
  });
}

export function checkHumanAgentParity(ctx: ScanContext) {
  const chrome = ctx.chromeText ?? "";
  const aiBot = ctx.aiBotText ?? "";
  const score = similarity(chrome, aiBot);
  const verdict =
    chrome.trim().length === 0 || aiBot.trim().length === 0
      ? "fail"
      : score >= 0.85
        ? "pass"
        : score >= 0.65
          ? "partial"
          : "fail";
  return makeCheck(ctx, "retrieval.human_agent_parity", {
    verdict,
    confidence: 0.88,
    evidence: {
      similarity: Number(score.toFixed(4)),
      threshold: 0.85,
      chrome_chars: chrome.length,
      ai_bot_chars: aiBot.length,
    },
    snippet: `chrome: ${chrome.slice(0, 200)} | agent: ${aiBot.slice(0, 200)}`,
  });
}

const CONTACT_PATH = /(^|\/)(contact|contact-us|support|get-in-touch)(\/|$)/i;
const CONTACT_WORD = /\b(contact|email|phone|call us|get in touch|reach us)\b/i;
const MAIL_RE = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+/i;
const TEL_RE = /^tel:\+?[0-9][0-9\s().-]{3,}/i;

export function checkTrustPages(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const links = pages.flatMap((page) => page.links);
  const nullContactLinks = links.filter(
    (link) => link.href === null && CONTACT_WORD.test(link.text),
  );
  const realMailTo = links.filter(
    (link) => link.href && MAIL_RE.test(link.href),
  );
  const realTel = links.filter((link) => link.href && TEL_RE.test(link.href));
  const reachableContactPages = links.filter((link) => {
    if (!link.href) return false;
    try {
      const url = new URL(link.href, ctx.normalizedUrl);
      return (
        CONTACT_PATH.test(url.pathname) &&
        hostnameOf(url.toString()) === hostnameOf(ctx.normalizedUrl)
      );
    } catch {
      return false;
    }
  });
  const knownPaths = new Set(
    pages.map((page) => {
      try {
        return new URL(page.url).pathname.toLowerCase();
      } catch {
        return page.url.toLowerCase();
      }
    }),
  );
  const reachablePageUrls = reachableContactPages.filter((link) => {
    try {
      return knownPaths.has(
        new URL(link.href ?? "", ctx.normalizedUrl).pathname.toLowerCase(),
      );
    } catch {
      return false;
    }
  });
  const found = realMailTo.length + realTel.length + reachablePageUrls.length;
  const verdict =
    nullContactLinks.length > 0
      ? "fail"
      : found > 0
        ? "pass"
        : reachableContactPages.length > 0
          ? "partial"
          : "fail";
  return makeCheck(ctx, "retrieval.trust_pages", {
    verdict,
    confidence: 0.87,
    evidence: {
      mailto_links: realMailTo.length,
      tel_links: realTel.length,
      reachable_contact_pages: reachablePageUrls.length,
      contact_links_without_destination: nullContactLinks.length,
      total_links_checked: links.length,
    },
    snippet:
      unique([
        ...realMailTo.map((link) => link.href ?? ""),
        ...realTel.map((link) => link.href ?? ""),
        ...reachableContactPages.map((link) => link.href ?? ""),
        ...nullContactLinks.map((link) => `null destination: ${link.text}`),
      ])
        .slice(0, 4)
        .join(" | ") || null,
  });
}

/** Exported for tests and for other deterministic consumers. */
export function robotsAgentAllowanceForTest(
  robotsTxt: string,
  alias: string,
): boolean {
  return agentAllowance(parseRobots(robotsTxt), [alias]).allowed;
}

/** Kept exported so page-level predicates can be reused without duplication. */
export function isHtmlPage(page: PageSnapshot): boolean {
  return page.status === 200 && /html/i.test(page.contentType);
}
