/**
 * Regression tests for the live-scan acceptance gaps:
 *  - sampled_urls must not repeat the homepage after a redirect,
 *  - internal candidates must come from raw HTML, rendered HTML and sitemap,
 *    and the standard probe set must include /ai,
 *  - contact/email anchors with no destination must fail trust_pages,
 *  - hash-only navigation anchors must be penalized,
 *  - all 31 checks and 7 protocols are still returned exactly once and remain
 *    schema-valid under those regressions.
 *
 * Every fixture here is synthetic and performs no network calls.
 */
import { describe, expect, it } from "vitest";
import {
  CHECK_KEYS,
  CheckResultSchema,
  PROTOCOL_KEYS,
  type CheckKey,
  type CheckResult,
  type LinkInfo,
  type PageSnapshot,
  type ScanContext,
} from "@offscript/shared";
import { detectProtocols, runChecks } from "@offscript/scanner";
import {
  collectInternalCandidates,
  dedupeSampled,
  normalizedUrlKey,
  planPriorityProbes,
} from "../src/crawler.js";
import { makeGoldContext } from "./factories.js";

function firstPage(ctx: ScanContext): PageSnapshot {
  const page = ctx.pages[0];
  if (page === undefined) throw new Error("fixture has no pages");
  return page;
}

function verdictOf(
  checks: readonly CheckResult[],
  key: CheckKey,
): string | undefined {
  return checks.find((check) => check.key === key)?.verdict;
}

function withLinks(ctx: ScanContext, links: readonly LinkInfo[]): ScanContext {
  for (const page of ctx.pages) page.links = [...links];
  return ctx;
}

describe("crawler discovery and sampling", () => {
  it("deduplicates sampled URLs by normalized href (including www redirects)", () => {
    const base = firstPage(makeGoldContext());
    const redirectCopy: PageSnapshot = {
      ...base,
      url: "https://www.gold.test/",
    };
    const realPage: PageSnapshot = { ...base, url: "https://gold.test/ai" };

    const result = dedupeSampled([base, redirectCopy, realPage, realPage]);

    expect(result.sampledUrls).toEqual([
      "https://gold.test/",
      "https://gold.test/ai",
    ]);
    expect(result.pages).toHaveLength(2);
    expect(normalizedUrlKey("https://gold.test/")).toBe(
      normalizedUrlKey("https://www.gold.test/#top"),
    );
  });

  it("collects internal candidates from raw HTML, rendered HTML and the sitemap", () => {
    const base = firstPage(makeGoldContext());
    const page: PageSnapshot = {
      ...base,
      url: "https://gold.test/",
      links: [],
      rawHtml:
        '<a href="/">Home</a><a href="/ai">AI</a><a href="#top">Top</a>' +
        '<a href="mailto:hello@gold.test">Mail</a>',
      renderedHtml: '<a href="/pricing">Pricing</a><a href="/ai">AI again</a>',
    };
    const sitemap =
      '<?xml version="1.0"?><urlset><url><loc>https://gold.test/about</loc></url></urlset>';

    const candidates = collectInternalCandidates(
      "https://gold.test",
      "gold.test",
      page,
      sitemap,
      page.url,
    );
    const aiKey = normalizedUrlKey("https://gold.test/ai");

    expect(
      candidates.filter((url) => normalizedUrlKey(url) === aiKey),
    ).toHaveLength(1);
    expect(candidates).toContain("https://gold.test/pricing");
    expect(candidates).toContain("https://gold.test/about");
    expect(candidates).not.toContain("https://gold.test/");
    expect(candidates).not.toContain("https://gold.test/#top");
  });

  it("probes /ai and the standard paths only when few candidates were found", () => {
    const probes = planPriorityProbes([], "https://gold.test");
    expect(probes).toContain("https://gold.test/ai");
    expect(probes).toContain("https://gold.test/pricing");
    expect(probes).toContain("https://gold.test/about");
    expect(probes).toContain("https://gold.test/contact");
    expect(probes).toContain("https://gold.test/docs");
    expect(probes).toContain("https://gold.test/privacy");
    expect(probes).toContain("https://gold.test/terms");
    expect(probes).toContain("https://gold.test/refunds");
    expect(probes).toHaveLength(8);

    expect(
      planPriorityProbes(
        [
          "https://gold.test/pricing",
          "https://gold.test/about",
          "https://gold.test/contact",
        ],
        "https://gold.test",
      ),
    ).toEqual([]);
  });
});

describe("retrieval.trust_pages regression", () => {
  it("fails when contact/email anchors have no destination", () => {
    const ctx = withLinks(makeGoldContext(), [
      { text: "Contact", href: null, raw: "", rel: "" },
      { text: "Email us", href: null, raw: "", rel: "" },
      { text: "hello@gold.test", href: null, raw: "", rel: "" },
    ]);
    const check = runChecks(ctx).find(
      (candidate) => candidate.key === "retrieval.trust_pages",
    );

    expect(check?.verdict).toBe("fail");
    expect(CheckResultSchema.safeParse(check).success).toBe(true);
    expect(check?.evidence["contact_links_without_destination"]).toBe(
      ctx.pages.length * 3,
    );
    const labels = check?.evidence["contact_labels_without_destination"];
    expect(Array.isArray(labels)).toBe(true);
    expect(labels).toContain("Email us");
  });

  it("still passes when a real mailto: exists next to a broken link", () => {
    const ctx = withLinks(makeGoldContext(), [
      { text: "Contact", href: null, raw: "", rel: "" },
      {
        text: "hello@gold.test",
        href: "mailto:hello@gold.test",
        raw: "mailto:hello@gold.test",
        rel: "",
      },
    ]);
    const check = runChecks(ctx).find(
      (candidate) => candidate.key === "retrieval.trust_pages",
    );

    expect(check?.verdict).toBe("pass");
    expect(check?.evidence["contact_links_without_destination"]).toBe(
      ctx.pages.length,
    );
  });
});

describe("browser.navigation_semantics regression", () => {
  it("penalizes anchors whose only destination is a hash fragment", () => {
    const ctx = withLinks(makeGoldContext(), [
      { text: "Top", href: "https://gold.test/#top", raw: "#top", rel: "" },
      { text: "Back", href: "https://gold.test/#", raw: "#", rel: "" },
      {
        text: "Home",
        href: "javascript:void(0)",
        raw: "javascript:void(0)",
        rel: "",
      },
    ]);
    const check = runChecks(ctx).find(
      (candidate) => candidate.key === "browser.navigation_semantics",
    );

    expect(check?.verdict).toBe("fail");
    expect(CheckResultSchema.safeParse(check).success).toBe(true);
    expect(check?.evidence["real_nav_links"]).toBe(0);
    expect(check?.evidence["hash_only_nav_links"]).toBe(ctx.pages.length * 3);
  });

  it("keeps real anchors as valid navigation", () => {
    const checks = runChecks(makeGoldContext());
    expect(verdictOf(checks, "browser.navigation_semantics")).toBe("pass");
  });
});

describe("fixed contracts under the regression context", () => {
  it("returns all 31 checks and 7 protocols exactly once, all schema-valid", () => {
    const ctx = withLinks(makeGoldContext(), [
      { text: "Top", href: "https://gold.test/#top", raw: "#top", rel: "" },
      { text: "Contact", href: null, raw: "", rel: "" },
    ]);

    const checks = runChecks(ctx);
    expect(checks).toHaveLength(31);
    expect(new Set(checks.map((check) => check.key)).size).toBe(31);
    expect(checks.map((check) => check.key)).toEqual([...CHECK_KEYS]);
    for (const check of checks) {
      expect(CheckResultSchema.safeParse(check).success).toBe(true);
    }

    const protocols = detectProtocols(ctx);
    expect(protocols).toHaveLength(7);
    expect(new Set(protocols.map((protocol) => protocol.key)).size).toBe(7);
    expect(protocols.map((protocol) => protocol.key)).toEqual([
      ...PROTOCOL_KEYS,
    ]);
  });
});
