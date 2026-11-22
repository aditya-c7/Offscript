/** Deterministic checks derived from browser/DOM observations. */
import { htmlPages, makeCheck, ratio } from "./util.js";
import type { LinkInfo, PageSnapshot, ScanContext } from "@offscript/shared";

const NAV_TEXT =
  /\b(home|about|pricing|price|contact|docs|documentation|blog|products?|services?|support|menu|next|previous|back|shop|login|sign\s*in|privacy|terms|refund|faq)\b/i;
const HASH_ONLY = /^#/;
const JS_VOID = /^javascript:\s*void\s*\(\s*0\s*\)\s*;?$/i;

/**
 * True when an anchor does not actually navigate anywhere: a bare `#top`-style
 * fragment, `javascript:void(0)`, or an absolute link that only differs from
 * the current document by its fragment.
 */
function isHashOnlyDestination(link: LinkInfo, page: PageSnapshot): boolean {
  const raw = link.raw.trim();
  if (HASH_ONLY.test(raw) || JS_VOID.test(raw)) return true;
  if (link.href === null) return false;
  try {
    const destination = new URL(link.href, page.url);
    const current = new URL(page.url);
    return (
      destination.origin === current.origin &&
      destination.pathname === current.pathname &&
      destination.search === current.search &&
      destination.hash.length > 0
    );
  } catch {
    return false;
  }
}

export function checkNavigationSemantics(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  let realLinks = 0;
  let jsNav = 0;
  let hashOnlyNav = 0;
  const samples: string[] = [];
  const hashOnlySamples: string[] = [];
  for (const page of pages) {
    const hashOnly = page.links.filter((link) =>
      isHashOnlyDestination(link, page),
    );
    hashOnlyNav += hashOnly.length;
    for (const link of hashOnly.slice(0, 2)) {
      hashOnlySamples.push(
        `${page.url}: "${link.text.slice(0, 32)}" -> ${link.raw || link.href || "null"}`,
      );
    }
    const links = page.links.filter(
      (link) =>
        typeof link.href === "string" &&
        link.href.trim().length > 0 &&
        !/^(javascript:|#)/i.test(link.href.trim()) &&
        !isHashOnlyDestination(link, page),
    );
    realLinks += links.length;
    for (const link of links.slice(0, 2)) {
      samples.push(`<a href="${link.href}">${link.text.slice(0, 32)}</a>`);
    }
    const buttonNav = page.buttons.filter(
      (button) =>
        button.hasOnClick &&
        NAV_TEXT.test(`${button.text} ${button.ariaLabel ?? ""}`),
    ).length;
    const inlineNav = (
      page.renderedHtml.match(
        /<(?:div|span|li|p|button)\b[^>]*\bonclick\s*=/gi,
      ) ?? []
    ).length;
    const pageJsNav = Math.max(buttonNav, inlineNav);
    jsNav += pageJsNav;
    if (pageJsNav > 0)
      samples.push(`${pageJsNav} onclick nav control(s) on ${page.url}`);
  }
  // Hash-only nav anchors are dead ends: they count against the real-link
  // ratio just like onclick-only controls do.
  const score = ratio(realLinks, realLinks + jsNav + hashOnlyNav);
  const verdict =
    realLinks > 0 && score >= 0.8 ? "pass" : score >= 0.5 ? "partial" : "fail";
  return makeCheck(ctx, "browser.navigation_semantics", {
    verdict,
    confidence: 0.9,
    evidence: {
      real_nav_links: realLinks,
      onclick_nav_controls: jsNav,
      hash_only_nav_links: hashOnlyNav,
      hash_only_examples: hashOnlySamples.slice(0, 5),
      real_link_ratio: score,
      threshold: 0.8,
      pages_checked: pages.length,
    },
    snippet:
      [...samples.slice(0, 4), ...hashOnlySamples.slice(0, 2)].join(" | ") ||
      null,
    selector: "a[href], [onclick]",
  });
}

export function checkDomStability(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const clsValues = pages.map((page) => page.cls);
  const settleValues = pages.map((page) => page.settledMs);
  const maxCls = clsValues.length > 0 ? Math.max(...clsValues) : 0;
  const maxSettledMs = settleValues.length > 0 ? Math.max(...settleValues) : 0;
  const clsOk = maxCls <= 0.1;
  const settleOk = maxSettledMs <= 1500;
  const verdict =
    clsOk && settleOk ? "pass" : clsOk || settleOk ? "partial" : "fail";
  return makeCheck(ctx, "browser.dom_stability", {
    verdict,
    confidence: 0.85,
    evidence: {
      pages_checked: pages.length,
      max_cls: maxCls,
      max_settled_ms: maxSettledMs,
      cls_threshold: 0.1,
      settled_threshold_ms: 1500,
    },
  });
}

export function checkReliableRendering(ctx: ScanContext) {
  const errors = ctx.pages.flatMap((page) =>
    page.pageErrors.map((error) => `${page.url}: ${error}`),
  );
  return makeCheck(ctx, "browser.reliable_rendering", {
    verdict: errors.length === 0 ? "pass" : "fail",
    confidence: 0.95,
    evidence: {
      pages_checked: ctx.pages.length,
      page_error_count: errors.length,
      errors: errors.slice(0, 10),
    },
    snippet: errors.slice(0, 3).join(" | ") || null,
  });
}

export function checkCoordinateOnlyRisk(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  let canvasIframe = 0;
  let nativeControls = 0;
  for (const page of pages) {
    canvasIframe += page.canvasCount + page.iframeCount;
    nativeControls +=
      page.buttons.length +
      page.links.filter(
        (link) => typeof link.href === "string" && link.href.length > 0,
      ).length +
      page.forms.reduce(
        (sum, form) => sum + form.fields.length + form.buttons.length,
        0,
      );
  }
  const total = canvasIframe + nativeControls;
  const share = total === 0 ? 0 : canvasIframe / total;
  const verdict =
    canvasIframe === 0 || share <= 0.2
      ? "pass"
      : share <= 0.5
        ? "partial"
        : "fail";
  return makeCheck(ctx, "browser.coordinate_only_risk", {
    verdict,
    confidence: 0.83,
    evidence: {
      canvas_elements: pages.reduce((sum, page) => sum + page.canvasCount, 0),
      iframe_elements: pages.reduce((sum, page) => sum + page.iframeCount, 0),
      native_controls: nativeControls,
      coordinate_only_share: share,
      threshold: 0.2,
    },
    selector: "canvas, iframe",
  });
}

export function checkFeedbackSurfaces(ctx: ScanContext) {
  const pages = htmlPages(ctx);
  const alerts = pages.reduce((sum, page) => sum + page.ariaAlertCount, 0);
  const dialogs = pages.reduce((sum, page) => sum + page.ariaDialogCount, 0);
  const live = pages.reduce((sum, page) => sum + page.ariaLiveCount, 0);
  const surfaces = pages.flatMap((page) => page.feedbackSurfaces);
  const explicit = alerts + dialogs + live;
  const verdict =
    explicit > 0 ? "pass" : surfaces.length > 0 ? "partial" : "fail";
  return makeCheck(ctx, "browser.feedback_surfaces", {
    verdict,
    confidence: 0.88,
    evidence: {
      pages_checked: pages.length,
      role_alert_count: alerts,
      role_dialog_count: dialogs,
      aria_live_count: live,
      feedback_surface_labels: surfaces.slice(0, 10),
    },
    snippet: surfaces.slice(0, 4).join(" | ") || null,
    selector: "[role=alert], [role=dialog], [role=status], [aria-live]",
  });
}
