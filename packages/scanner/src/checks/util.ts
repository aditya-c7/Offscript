/**
 * Internal helpers shared by the deterministic checks. No network and no LLM
 * calls happen here — everything is computed from an already-built ScanContext.
 */
import {
  CHECK_META,
  type CheckKey,
  type CheckResult,
  type PageSnapshot,
  type ScanContext,
  type Verdict,
} from "@offscript/shared";
import { buildFixPrompts } from "../fix-prompts.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 1 : clamp01(numerator / denominator);
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9$€£]+/g) ?? []).filter(
    (token) => token.length >= 2,
  );
}

/** Normalized token-set Jaccard similarity (deterministic, no dependencies). */
export function similarity(a: string, b: string): number {
  const aSet = new Set(tokens(a));
  const bSet = new Set(tokens(b));
  if (aSet.size === 0 && bSet.size === 0) return 1;
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = aSet.size + bSet.size - intersection;
  return union <= 0 ? 1 : intersection / union;
}

/** Strip tags/scripts and normalize whitespace into comparable text. */
export function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39|#x27);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recursively collect every string value from an unknown JSON-like value. */
export function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  if (typeof value === "string") return value.trim().length > 0 ? [value] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((item) =>
      collectStrings(item, depth + 1),
    );
  }
  return [];
}

/** Collect the values of named keys (e.g. name, sameAs, url) in JSON-LD. */
export function collectNamedStrings(
  value: unknown,
  names: ReadonlySet<string>,
  depth = 0,
): string[] {
  if (depth > 6) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectNamedStrings(item, names, depth + 1));
  }
  if (!isRecord(value)) return [];
  const found: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (names.has(key.toLowerCase())) {
      found.push(...collectStrings(item));
    }
    found.push(...collectNamedStrings(item, names, depth + 1));
  }
  return unique(found);
}

export function hostnameOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return (
      value
        .replace(/^https?:\/\//i, "")
        .split("/")[0]
        ?.split(":")[0]
        ?.replace(/^www\./i, "")
        .toLowerCase() ?? ""
    );
  }
}

export function allText(ctx: ScanContext): string {
  return ctx.pages
    .map((page) => `${page.title}\n${page.text}\n${page.visibleText}`)
    .join("\n");
}

export function htmlPages(ctx: ScanContext): PageSnapshot[] {
  return ctx.pages.filter(
    (page) => page.status === 200 && /html/i.test(page.contentType),
  );
}

export function primaryPage(ctx: ScanContext): PageSnapshot | undefined {
  const html = htmlPages(ctx);
  const exact = html.find((page) => page.url === ctx.normalizedUrl);
  return exact ?? html[0] ?? ctx.pages[0];
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function reproduceFor(
  key: CheckKey,
  url: string,
  selector: string | null,
): string {
  const q = shellQuote(url);
  switch (key) {
    case "retrieval.sitemap_freshness":
      return `curl -sSL -D - ${shellQuote(urlSafePath(url, "/sitemap.xml"))} | head -n 40`;
    case "retrieval.canonical_urls":
      return `curl -sSL ${q} | grep -oiE '<link[^>]+rel=["'"'"']?canonical[^>]*>'`;
    case "retrieval.http_404_semantics":
      return `curl -sS -o /dev/null -w '%{http_code}\\n' ${shellQuote(urlSafePath(url, "/__offscript_nonexistent__"))}`;
    case "retrieval.https_enforcement":
      return `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\\n' ${shellQuote(url.replace(/^https:\/\//i, "http://"))}`;
    case "retrieval.ai_bot_http_access":
      return `curl -sS -o /dev/null -w '%{http_code}\\n' -A 'Offscript-Agent/1.0' ${q}`;
    case "retrieval.robots_user_acting_agents":
      return `curl -sSL ${shellQuote(urlSafePath(url, "/robots.txt"))}`;
    case "retrieval.human_agent_parity":
      return `diff <(curl -sSL -A 'Mozilla/5.0' ${q}) <(curl -sSL -A 'Offscript-Agent/1.0' ${q})`;
    case "content.basic_a11y_alt_lang":
    case "content.landmarks":
    case "content.heading_hierarchy":
    case "content.initial_ssr_facts":
    case "content.structured_data_jsonld":
      return `curl -sSL ${q} | grep -oiE '<(html|title|meta|main|header|nav|footer|h1|img|script)[^>]*>' | head -n 40`;
    case "browser.dom_stability":
    case "browser.reliable_rendering":
    case "browser.coordinate_only_risk":
    case "browser.feedback_surfaces":
      return `npx playwright open ${q}  # inspect console, layout shifts and canvas/iframe controls`;
    case "interaction.side_effect_boundaries":
    case "interaction.outcome_observability":
    case "interaction.control_contract":
    case "interaction.accessible_button_names":
    case "interaction.form_field_labeling":
    case "interaction.state_announcements":
      return `curl -sSL ${q} | grep -oiE '<(form|button|input|label|select|textarea)[^>]*>' | head -n 60`;
    case "identity.operator_name":
    case "identity.about_page":
    case "identity.privacy_policy":
    case "identity.terms_of_service":
    case "identity.returns_refunds":
    case "identity.external_profiles":
    case "identity.pricing_offering_clarity":
    case "retrieval.trust_pages":
      return `curl -sSL ${q} | grep -oiE '<(a|footer)[^>]*>[^<]*(about|privacy|terms|contact|refund|me)[^<]*</a>|mailto:[^"'"'"' ]+|tel:[^"'"'"' ]+' | head -n 40`;
    case "browser.navigation_semantics":
      return `curl -sSL ${q} | grep -oiE '<a[^>]+href=[^>]*>|<(div|button)[^>]+onclick=[^>]*>' | head -n 60`;
    default:
      return `curl -sSL -D - ${q}${selector ? ` | grep -nF ${shellQuote(selector)}` : ""}`;
  }
}

function urlSafePath(url: string, pathname: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = pathname;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return `${url.replace(/\/$/, "")}${pathname}`;
  }
}

export interface CheckDraft {
  verdict: Verdict;
  confidence: number;
  evidence: Record<string, unknown>;
  selector?: string | null;
  snippet?: string | null;
  pageUrl?: string;
  reproduceCmd?: string;
}

/** Construct a fully populated CheckResult, including its fix prompt. */
export function makeCheck(
  ctx: ScanContext,
  key: CheckKey,
  draft: CheckDraft,
): CheckResult {
  const meta = CHECK_META[key];
  const pageUrl = draft.pageUrl ?? ctx.normalizedUrl ?? ctx.submittedUrl;
  const result: CheckResult = {
    key,
    category: meta.category,
    area: meta.area,
    verdict: draft.verdict,
    impact: meta.impact,
    confidence: clamp01(draft.confidence),
    page_url: pageUrl,
    selector: draft.selector ?? null,
    snippet: draft.snippet ?? null,
    reproduce_cmd:
      draft.reproduceCmd ?? reproduceFor(key, pageUrl, draft.selector ?? null),
    fix_prompt_md: "",
    evidence: draft.evidence,
  };
  const fix = buildFixPrompts(result, ctx.detectedStack);
  return { ...result, fix_prompt_md: fix.combined_md };
}
