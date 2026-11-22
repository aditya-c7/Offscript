/** Deterministic checks for operator identity and trust information. */
import {
  CHECK_META,
  type CheckKey,
  type CheckResult,
  type ScanContext,
} from "@offscript/shared";
import {
  allText,
  collectNamedStrings,
  htmlText,
  htmlPages,
  makeCheck,
} from "./util.js";

function pathnameOf(href: string, base: string): string | null {
  try {
    return new URL(href, base).pathname.toLowerCase();
  } catch {
    return null;
  }
}

function knownPaths(ctx: ScanContext): Set<string> {
  return new Set(
    htmlPages(ctx)
      .map((page) => pathnameOf(page.url, ctx.normalizedUrl))
      .filter((path): path is string => path !== null),
  );
}

function footerTexts(ctx: ScanContext): string {
  return htmlPages(ctx)
    .flatMap((page) => [
      ...(page.renderedHtml.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi) ?? []),
      ...(page.rawHtml.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi) ?? []),
    ])
    .map((block) => htmlText(block))
    .join(" ");
}

export function checkOperatorName(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const jsonLd = pages.flatMap((page) => page.jsonLd ?? []);
  const names = collectNamedStrings(
    jsonLd,
    new Set(["name", "legalname", "operatorname"]),
  );
  const footer = footerTexts(ctx);
  const haystack =
    `${footer} ${pages.map((page) => `${page.title} ${page.visibleText} ${page.text}`).join(" ")}`.toLowerCase();
  const matched = names.filter((name) =>
    haystack.includes(name.toLowerCase().slice(0, 80)),
  );
  const candidate =
    footer.match(/\b[A-Z][a-z]+(?:\s+[A-Z][\w&-]+){0,3}\b/)?.[0] ?? "";
  const candidateLooksLegal =
    /\b(inc|llc|ltd|co|corp|gmbh|limited|company)\b/i.test(candidate) ||
    (() => {
      const hostToken =
        ctx.host
          .replace(/^www\./i, "")
          .split(".")[0]
          ?.toLowerCase() ?? "";
      return (
        hostToken.length > 3 &&
        candidate.toLowerCase().includes(hostToken.slice(0, 4))
      );
    })();
  const found =
    matched.length > 0 || (candidateLooksLegal && candidate.length > 0);
  const verdict = found ? "pass" : "fail";
  return makeCheck(ctx, "identity.operator_name", {
    verdict,
    confidence: 0.78,
    evidence: {
      jsonld_names: names.slice(0, 8),
      matched_names: matched.slice(0, 8),
      footer_candidate: candidate || null,
      footer_chars: footer.length,
    },
    snippet: matched[0] ?? candidate ?? null,
  });
}

function checkLinkedIdentityPage(
  ctx: ScanContext,
  key:
    | "identity.about_page"
    | "identity.privacy_policy"
    | "identity.terms_of_service",
  matcher: RegExp,
): CheckResult {
  const pages = htmlPages(ctx);
  const links = pages.flatMap((page) => page.links);
  const candidates = links.filter(
    (link) =>
      typeof link.href === "string" &&
      link.href.trim().length > 0 &&
      !/^(javascript:|#)/i.test(link.href.trim()) &&
      matcher.test(`${link.text} ${link.href}`),
  );
  const missingDestination = links.filter(
    (link) => link.href === null && matcher.test(link.text),
  );
  const paths = knownPaths(ctx);
  const reachable = candidates.filter((link) => {
    const path = pathnameOf(link.href ?? "", ctx.normalizedUrl);
    return path !== null && paths.has(path);
  });
  const mentionsPolicy = matcher.test(allText(ctx));
  const verdict =
    missingDestination.length > 0 && reachable.length === 0
      ? "fail"
      : reachable.length > 0
        ? "pass"
        : candidates.length > 0 || mentionsPolicy
          ? "partial"
          : "fail";
  return makeCheck(ctx, key, {
    verdict,
    confidence: 0.86,
    evidence: {
      matching_links: candidates.length,
      reachable_links: reachable.length,
      links_without_destination: missingDestination.length,
      text_mentions_topic: mentionsPolicy,
      sample_href: candidates[0]?.href ?? null,
    },
    snippet:
      candidates
        .slice(0, 3)
        .map((link) => `${link.text} -> ${link.href ?? "null"}`)
        .join(" | ") || null,
  });
}

export function checkAboutPage(ctx: ScanContext): CheckResult {
  return checkLinkedIdentityPage(
    ctx,
    "identity.about_page",
    /(\/|^)(about|about-us|company|who-we-are)(\/|$)|^about us$|^about$/i,
  );
}

export function checkPrivacyPolicy(ctx: ScanContext): CheckResult {
  return checkLinkedIdentityPage(
    ctx,
    "identity.privacy_policy",
    /privacy|privacy-policy|data-protection/i,
  );
}

export function checkTermsOfService(ctx: ScanContext): CheckResult {
  return checkLinkedIdentityPage(
    ctx,
    "identity.terms_of_service",
    /terms|tos|terms-of-service|terms-and-conditions|conditions-of-use/i,
  );
}

export function checkReturnsRefunds(ctx: ScanContext) {
  const text = allText(ctx);
  const commercial =
    /\b(price|pricing|buy|shop|cart|checkout|plan|plans|subscription|order|product|products|purchase|payment|refund)\b/i.test(
      text,
    ) ||
    /(\$|€|£)\s?\d|\b\d+(?:[.,]\d+)?\s?(usd|eur|gbp|dollars?|per month|per year|\/mo|\/yr)\b/i.test(
      text,
    );
  if (!commercial) {
    return makeCheck(ctx, "identity.returns_refunds", {
      verdict: "not_applicable",
      confidence: 0.9,
      evidence: { commercial_site_detected: false },
    });
  }
  const links = htmlPages(ctx).flatMap((page) => page.links);
  const paths = knownPaths(ctx);
  const candidates = links.filter((link) =>
    /(\/|^)(returns?|refunds?|return-policy|refund-policy)(\/|$)/i.test(
      link.href ?? "",
    ),
  );
  const reachable = candidates.filter((link) => {
    const path = pathnameOf(link.href ?? "", ctx.normalizedUrl);
    return path !== null && paths.has(path);
  });
  const mentions = /\b(returns?|refunds?|money.back)\b/i.test(text);
  const verdict =
    reachable.length > 0
      ? "pass"
      : candidates.length > 0 || mentions
        ? "partial"
        : "fail";
  return makeCheck(ctx, "identity.returns_refunds", {
    verdict,
    confidence: 0.84,
    evidence: {
      commercial_site_detected: true,
      matching_links: candidates.length,
      reachable_links: reachable.length,
      text_mentions_returns: mentions,
    },
    snippet:
      candidates
        .slice(0, 3)
        .map((link) => link.href ?? "")
        .join(" | ") || null,
  });
}

export function checkExternalProfiles(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const links = pages.flatMap((page) => page.links);
  const relMe = links.filter((link) =>
    link.rel.toLowerCase().split(/\s+/).includes("me"),
  );
  const sameAs = pages.flatMap((page) =>
    collectNamedStrings(page.jsonLd ?? [], new Set(["sameas"])),
  );
  const social = links.filter((link) =>
    /(^|\.)(github|linkedin|twitter|x|facebook|instagram|youtube|mastodon|bluesky)\./i.test(
      link.href ?? "",
    ),
  );
  const total =
    new Set([...relMe, ...social].map((link) => link.href ?? "")).size +
    sameAs.length;
  const verdict = total > 0 ? "pass" : "fail";
  return makeCheck(ctx, "identity.external_profiles", {
    verdict,
    confidence: 0.88,
    evidence: {
      rel_me_links: relMe.length,
      social_links: social.length,
      jsonld_same_as: sameAs.length,
      distinct_profiles: total,
    },
    snippet:
      [...relMe, ...social]
        .slice(0, 4)
        .map((link) => link.href ?? "")
        .join(" | ") || null,
  });
}

const OFFERING_WORDS =
  /\b(offer|offers|offering|offerings|service|services|product|products|plan|plans|consulting|hosting|support|software|solution|solutions|subscription|membership|training)\b/i;
const PRICE_PATTERN =
  /(\$|€|£)\s?\d|\b\d+(?:[.,]\d+)?\s?(usd|eur|gbp|dollars?|per month|per year|per user|\/mo|\/yr)\b/i;
const FREE_OR_QUOTE =
  /\bfree\b|no cost|contact us (for|about) (pricing|a quote)|request a quote|get a quote|pricing on request|talk to sales|pricing on application/i;

export function checkPricingOfferingClarity(ctx: ScanContext) {
  const visible = htmlPages(ctx)
    .map((page) => `${page.visibleText || page.text}`)
    .join("\n");
  const offering = OFFERING_WORDS.test(visible);
  const priced = PRICE_PATTERN.test(visible);
  const freeOrQuote = FREE_OR_QUOTE.test(visible);
  const verdict =
    offering && (priced || freeOrQuote)
      ? "pass"
      : offering || priced
        ? "partial"
        : "fail";
  const title = CHECK_META["identity.pricing_offering_clarity"].title;
  return makeCheck(ctx, "identity.pricing_offering_clarity", {
    verdict,
    confidence: 0.82,
    evidence: {
      offering_words_found: offering,
      price_found: priced,
      free_or_quote_model_found: freeOrQuote,
      visible_chars_sampled: visible.slice(0, 1200).length,
    },
    snippet: `${title}: ${visible.slice(0, 300)}` || null,
  });
}
