/** Deterministic checks for the content and structure of pages. */
import type { PageSnapshot, ScanContext } from "@offscript/shared";
import {
  collectNamedStrings,
  hostnameOf,
  htmlPages,
  isRecord,
  makeCheck,
  ratio,
  tokens,
  unique,
} from "./util.js";

export function checkBasicA11yAltLang(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const withLang = pages.filter(
    (page) => (page.lang ?? "").trim().length > 0,
  ).length;
  const withTitle = pages.filter(
    (page) => (page.title ?? "").trim().length > 0,
  ).length;
  const withDescription = pages.filter(
    (page) => (page.description ?? "").trim().length > 0,
  ).length;
  let imageCount = 0;
  let imagesWithAlt = 0;
  for (const page of pages) {
    for (const image of page.images) {
      imageCount += 1;
      const alt = image.alt;
      if (alt !== null && alt.trim().length > 0) {
        imagesWithAlt += 1;
      } else if (alt === "" && image.width > 0 && image.height > 0) {
        // Explicitly decorative with reserved space.
        imagesWithAlt += 1;
      }
    }
  }
  const altCoverage = ratio(imagesWithAlt, imageCount);
  const score =
    0.25 * ratio(withLang, pages.length) +
    0.25 * ratio(withTitle, pages.length) +
    0.25 * ratio(withDescription, pages.length) +
    0.25 * altCoverage;
  const verdict =
    pages.length === 0
      ? "fail"
      : score >= 0.9
        ? "pass"
        : score >= 0.5
          ? "partial"
          : "fail";
  return makeCheck(ctx, "content.basic_a11y_alt_lang", {
    verdict,
    confidence: 0.93,
    evidence: {
      pages_checked: pages.length,
      with_lang: withLang,
      with_title: withTitle,
      with_description: withDescription,
      images_total: imageCount,
      images_with_alt: imagesWithAlt,
      alt_coverage: altCoverage,
      component_score: score,
    },
    snippet: pages[0]
      ? `lang=${pages[0].lang ?? "none"} | title=${pages[0].title} | description=${pages[0].description ?? "none"}`
      : null,
  });
}

function rawContentOnly(page: PageSnapshot): string {
  return (page.rawHtml ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function checkInitialSsrFacts(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  let totalTokens = 0;
  let foundTokens = 0;
  let pagesWithH1 = 0;
  let h1InSsr = 0;
  for (const page of pages) {
    const raw = rawContentOnly(page);
    const visible = page.visibleText || page.text || "";
    for (const token of unique(tokens(visible)).filter(
      (word) => word.length >= 3,
    )) {
      totalTokens += 1;
      if (raw.includes(token)) foundTokens += 1;
    }
    const h1s = page.headings.filter((heading) => heading.level === 1);
    if (h1s.length > 0) {
      pagesWithH1 += 1;
      if (
        /<h1[\s>]/i.test(page.rawHtml) &&
        h1s.some((heading) =>
          raw.includes(heading.text.toLowerCase().slice(0, 80)),
        )
      ) {
        h1InSsr += 1;
      }
    }
  }
  const textRatio = ratio(foundTokens, totalTokens);
  const h1Ratio = pagesWithH1 === 0 ? 0 : ratio(h1InSsr, pagesWithH1);
  const score = 0.75 * textRatio + 0.25 * h1Ratio;
  const verdict =
    pages.length === 0
      ? "fail"
      : score >= 0.7
        ? "pass"
        : score >= 0.4
          ? "partial"
          : "fail";
  return makeCheck(ctx, "content.initial_ssr_facts", {
    verdict,
    confidence: 0.9,
    evidence: {
      pages_checked: pages.length,
      visible_tokens: totalTokens,
      tokens_present_in_raw_html: foundTokens,
      text_ratio: textRatio,
      pages_with_h1: pagesWithH1,
      h1_present_in_ssr: h1InSsr,
      combined_score: score,
      threshold: 0.7,
    },
    snippet: pages[0]?.rawHtml.slice(0, 350) ?? null,
  });
}

export function checkLandmarks(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  let total = 0;
  let complete = 0;
  let partial = 0;
  for (const page of pages) {
    const count = Object.values(page.landmarks).filter(Boolean).length;
    total += count;
    if (count === 4) complete += 1;
    else if (count >= 2) partial += 1;
  }
  const average = pages.length === 0 ? 0 : total / (pages.length * 4);
  const verdict =
    pages.length === 0
      ? "fail"
      : complete === pages.length
        ? "pass"
        : average >= 0.5
          ? "partial"
          : "fail";
  return makeCheck(ctx, "content.landmarks", {
    verdict,
    confidence: 0.94,
    evidence: {
      pages_checked: pages.length,
      pages_with_all_four: complete,
      pages_with_two_or_three: partial,
      average_landmark_coverage: average,
      landmarks: ["main", "header", "nav", "footer"],
    },
    snippet: pages[0] ? JSON.stringify(pages[0].landmarks) : null,
  });
}

export function checkHeadingHierarchy(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  let goodPages = 0;
  let h1Issues = 0;
  let skippedIssues = 0;
  for (const page of pages) {
    const h1Count = page.headings.filter(
      (heading) => heading.level === 1,
    ).length;
    if (h1Count === 1) goodPages += 1;
    else h1Issues += 1;
    let previous = 0;
    for (const heading of page.headings) {
      if (previous > 0 && heading.level > previous + 1) skippedIssues += 1;
      previous = heading.level;
    }
  }
  const clean = h1Issues === 0 && skippedIssues === 0;
  const verdict =
    pages.length === 0
      ? "fail"
      : clean
        ? "pass"
        : goodPages > 0
          ? "partial"
          : "fail";
  return makeCheck(ctx, "content.heading_hierarchy", {
    verdict,
    confidence: 0.92,
    evidence: {
      pages_checked: pages.length,
      pages_with_exactly_one_h1: goodPages,
      h1_issues: h1Issues,
      skipped_levels: skippedIssues,
      headings_sample: pages[0]?.headings.slice(0, 8) ?? [],
    },
    snippet:
      (pages[0]?.headings ?? [])
        .slice(0, 6)
        .map((heading) => `H${heading.level}: ${heading.text}`)
        .join(" | ") || null,
  });
}

export function checkStructuredDataJsonLd(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  let validBlockPages = 0;
  let nameMatchPages = 0;
  let urlMatchPages = 0;
  let completePages = 0;
  let blockCount = 0;
  for (const page of pages) {
    const blocks = page.jsonLd ?? [];
    blockCount += blocks.length;
    const validBlock = blocks.some(
      (block) =>
        isRecord(block) &&
        typeof block["@context"] === "string" &&
        typeof block["@type"] === "string",
    );
    if (validBlock) validBlockPages += 1;
    const names = collectNamedStrings(
      blocks,
      new Set(["name", "legalname", "alternatename"]),
    ).map((name) => name.toLowerCase());
    const urls = collectNamedStrings(blocks, new Set(["url"]));
    const haystack =
      `${page.title} ${page.visibleText} ${page.text}`.toLowerCase();
    const nameMatch = names.some((name) =>
      haystack.includes(name.slice(0, 80)),
    );
    const pageHost = hostnameOf(page.url);
    const siteHost = hostnameOf(ctx.normalizedUrl);
    const urlMatch = urls.some(
      (url) => hostnameOf(url) === pageHost || hostnameOf(url) === siteHost,
    );
    if (nameMatch) nameMatchPages += 1;
    if (urlMatch) urlMatchPages += 1;
    if (validBlock && nameMatch && urlMatch) completePages += 1;
  }
  const verified = ratio(completePages, pages.length);
  const verdict =
    pages.length === 0
      ? "fail"
      : verified >= 0.999
        ? "pass"
        : validBlockPages > 0 && (nameMatchPages > 0 || urlMatchPages > 0)
          ? "partial"
          : "fail";
  return makeCheck(ctx, "content.structured_data_jsonld", {
    verdict,
    confidence: 0.86,
    evidence: {
      pages_checked: pages.length,
      jsonld_blocks: blockCount,
      pages_with_valid_block: validBlockPages,
      pages_with_matching_name: nameMatchPages,
      pages_with_matching_url: urlMatchPages,
      pages_verified: completePages,
      verified_coverage: verified,
    },
    snippet: pages[0]?.jsonLd.length
      ? JSON.stringify(pages[0]?.jsonLd[0]).slice(0, 350)
      : null,
  });
}
