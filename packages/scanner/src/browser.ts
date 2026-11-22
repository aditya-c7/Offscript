/// <reference path="../../../node_modules/.pnpm/node_modules/@types/node/index.d.ts" />
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import { z } from "zod";
import type { PageSnapshot } from "@offscript/shared";
import { assertSafeUrl } from "./ssrf.js";

const USER_AGENT = "Offscript-Agent/1.0";
const MUTATING_METHODS = new Set(["PUT", "PATCH", "DELETE", "TRACK", "TRACE"]);
const BLOCKED_RESOURCE_TYPES = new Set(["beacon", "eventsource"]);
const NAV_TIMEOUT_MS = 15_000;

const LinkSchema = z.object({
  text: z.string(),
  href: z.string().nullable(),
  rel: z.string(),
  raw: z.string(),
});
const FieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  id: z.string().nullable(),
  label: z.string().nullable(),
  autocomplete: z.string().nullable(),
  required: z.boolean(),
  tag: z.string(),
  selector: z.string(),
});
const ButtonSchema = z.object({
  text: z.string(),
  ariaLabel: z.string().nullable(),
  type: z.string().nullable(),
  selector: z.string(),
  hasOnClick: z.boolean(),
  disabled: z.boolean(),
});
const FormSchema = z.object({
  action: z.string().nullable(),
  method: z.string().nullable(),
  fields: z.array(FieldSchema),
  buttons: z.array(ButtonSchema),
  hasLiveRegion: z.boolean(),
  selector: z.string(),
});
const HeadingSchema = z.object({ level: z.number().int(), text: z.string() });
const ImageSchema = z.object({
  src: z.string(),
  alt: z.string().nullable(),
  width: z.number(),
  height: z.number(),
});
const DomSchema = z.object({
  title: z.string(),
  lang: z.string().nullable(),
  description: z.string().nullable(),
  canonical: z.string().nullable(),
  jsonLd: z.array(z.unknown()),
  links: z.array(LinkSchema),
  forms: z.array(FormSchema),
  buttons: z.array(ButtonSchema),
  headings: z.array(HeadingSchema),
  landmarks: z.object({
    main: z.boolean(),
    header: z.boolean(),
    nav: z.boolean(),
    footer: z.boolean(),
  }),
  images: z.array(ImageSchema),
  canvasCount: z.number().int(),
  iframeCount: z.number().int(),
  ariaLiveCount: z.number().int(),
  ariaDialogCount: z.number().int(),
  ariaAlertCount: z.number().int(),
  feedbackSurfaces: z.array(z.string()),
  stateAttrs: z.array(z.string()),
  text: z.string(),
  visibleText: z.string(),
  renderedHtml: z.string(),
});

export interface LoadPageOptions {
  allowJs?: boolean;
  recordCms?: boolean;
}

/**
 * Resolve a local Chromium binary. Prefer the Playwright-managed build, then
 * fall back to a system Chrome/Edge install. Never adds --no-sandbox.
 */
export function resolveChromiumExecutable(): string | undefined {
  const candidates: readonly string[] = [
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Launch Chromium with read-only-safe defaults. */
export async function getBrowser(): Promise<Browser> {
  const args = ["--disable-dev-shm-usage"];
  if (process.env.OFFSCRIPT_LOCAL_TEST === "1") {
    args.push("--no-sandbox");
  }
  const executablePath = resolveChromiumExecutable();
  return chromium.launch(executablePath ? { args, executablePath } : { args });
}

/**
 * Load a page in a locked-down context and capture a deterministic DOM
 * snapshot. The context (and every helper context) is always closed.
 */
export async function loadPage(
  browser: Browser,
  rawUrl: string,
  opts: LoadPageOptions = {},
): Promise<PageSnapshot> {
  const { url: target } = await assertSafeUrl(rawUrl);
  const targetUrl = target.href;
  const context = await browser.newContext({
    serviceWorkers: "block",
    userAgent: USER_AGENT,
    javaScriptEnabled: opts.allowJs !== false,
  });

  try {
    await context.addInitScript(() => {
      // esbuild (via tsx/next) may emit __name() wrappers inside serialized
      // evaluate callbacks. Provide a no-op shim in the page context.
      Reflect.set(globalThis, "__name", (fn: unknown) => fn);
      Reflect.set(globalThis, "__offscriptCls", 0);
      if (typeof PerformanceObserver === "undefined") return;
      try {
        const observer = new PerformanceObserver((list) => {
          const current: unknown = Reflect.get(globalThis, "__offscriptCls");
          let sum =
            typeof current === "number" && Number.isFinite(current)
              ? current
              : 0;
          for (const entry of list.getEntries()) {
            const recent: unknown = Reflect.get(entry, "hadRecentInput");
            const value: unknown = Reflect.get(entry, "value");
            if (
              recent !== true &&
              typeof value === "number" &&
              Number.isFinite(value)
            ) {
              sum += value;
            }
          }
          Reflect.set(globalThis, "__offscriptCls", sum);
        });
        observer.observe({ type: "layout-shift", buffered: true });
      } catch {
        // PerformanceObserver may not support layout-shift; CLS stays 0.
      }
    });

    await context.route("**/*", (route) => {
      const request = route.request();
      if (MUTATING_METHODS.has(request.method().toUpperCase())) {
        void route.abort();
        return;
      }
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        void route.abort();
        return;
      }
      void route.continue();
    });

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
    if (opts.recordCms === true) {
      page.on("console", (message) => {
        if (message.type() === "error") {
          pageErrors.push(`console: ${message.text()}`);
        }
      });
    }

    const started = Date.now();
    const response = await page.goto(targetUrl, {
      waitUntil: "load",
      timeout: NAV_TIMEOUT_MS,
    });

    try {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const startedAt = performance.now();
            let lastMutation = startedAt;
            const target: Node = document.body ?? document.documentElement;
            const observer = new MutationObserver(() => {
              lastMutation = performance.now();
            });
            observer.observe(target, {
              attributes: true,
              childList: true,
              characterData: true,
              subtree: true,
            });
            const tick = (): void => {
              const now = performance.now();
              if (now - lastMutation >= 500 || now - startedAt >= 8000) {
                observer.disconnect();
                resolve();
                return;
              }
              requestAnimationFrame(tick);
            };
            tick();
          }),
      );
    } catch {
      // A JS-disabled context may refuse evaluation; treat as already settled.
    }

    const settledMs = Date.now() - started;
    const domRaw: unknown = await page.evaluate(() => {
      function esc(value: string): string {
        try {
          return CSS.escape(value);
        } catch {
          return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        }
      }

      function selectorOf(el: Element): string {
        const id = el.getAttribute("id");
        if (id !== null && id.length > 0) {
          return `${el.tagName.toLowerCase()}#${esc(id)}`;
        }
        const parts: string[] = [];
        let node: Element | null = el;
        while (node !== null && node !== document.documentElement) {
          const current: Element = node;
          const tag = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (parent === null) {
            parts.unshift(tag);
            break;
          }
          const sameTag = Array.from(parent.children).filter(
            (child: Element) => child.tagName === current.tagName,
          );
          const index = sameTag.indexOf(current) + 1;
          parts.unshift(
            sameTag.length > 1 ? `${tag}:nth-of-type(${index})` : tag,
          );
          node = parent;
        }
        return parts.join(" > ");
      }

      function visibleTextOf(el: Element): string {
        const raw =
          el instanceof HTMLElement ? el.innerText : (el.textContent ?? "");
        return raw.replace(/\s+/g, " ").trim();
      }

      function toDimension(value: string | null): number {
        if (value === null) return 0;
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      }

      function buttonInfo(el: Element) {
        const value = el.getAttribute("value") ?? "";
        const aria = el.getAttribute("aria-label");
        return {
          text: visibleTextOf(el) || value,
          ariaLabel: aria !== null && aria.trim().length > 0 ? aria : null,
          type: el.getAttribute("type"),
          selector: selectorOf(el),
          hasOnClick:
            el.hasAttribute("onclick") ||
            typeof Reflect.get(el, "onclick") === "function",
          disabled:
            el.hasAttribute("disabled") ||
            el.getAttribute("aria-disabled") === "true",
        };
      }

      const body: HTMLElement | null = document.body;
      const normalize = (value: string): string =>
        value.replace(/\s+/g, " ").trim();
      const text = normalize(body?.textContent ?? "");
      const visibleText = normalize(body?.innerText ?? "");

      const descriptionEl = document.querySelector(
        'meta[name="description" i]',
      );
      const canonicalEl = document.querySelector('link[rel="canonical" i]');
      const jsonLd: unknown[] = [];
      for (const script of Array.from(
        document.querySelectorAll('script[type="application/ld+json" i]'),
      )) {
        try {
          const parsed: unknown = JSON.parse(script.textContent ?? "");
          jsonLd.push(parsed);
        } catch {
          // Ignore malformed JSON-LD blocks.
        }
      }

      // Collect every anchor, including ones with no href. "Contact"/"Email"
      // controls implemented as <a> without a destination are a real defect
      // and must be visible to the deterministic trust-page check.
      const links = Array.from(document.querySelectorAll("a")).map((a) => {
        const rawAttribute = a.getAttribute("href");
        const raw = rawAttribute ?? "";
        let href: string | null = null;
        if (rawAttribute !== null) {
          try {
            href = new URL(raw, location.href).toString();
          } catch {
            href = null;
          }
        }
        return {
          text: visibleTextOf(a),
          href,
          rel: a.getAttribute("rel") ?? "",
          raw,
        };
      });

      const forms = Array.from(document.querySelectorAll("form")).map(
        (form) => {
          const fields = Array.from(
            form.querySelectorAll("input, select, textarea"),
          ).map((field) => {
            const id = field.getAttribute("id");
            let label: string | null = null;
            if (id !== null && id.length > 0) {
              const labelEl = document.querySelector(`label[for="${esc(id)}"]`);
              if (labelEl !== null) label = visibleTextOf(labelEl);
            }
            if (label === null) {
              const wrapping = field.closest("label");
              if (wrapping !== null) label = visibleTextOf(wrapping);
            }
            if (label === null) {
              const ariaLabel = field.getAttribute("aria-label");
              if (ariaLabel !== null && ariaLabel.trim().length > 0) {
                label = ariaLabel.trim();
              }
            }
            const tag = field.tagName.toLowerCase();
            const declaredType = field.getAttribute("type");
            const fallbackType =
              tag === "textarea"
                ? "textarea"
                : tag === "select"
                  ? "select"
                  : "text";
            return {
              name: field.getAttribute("name") ?? "",
              type: declaredType ?? fallbackType,
              id,
              label,
              autocomplete: field.getAttribute("autocomplete"),
              required:
                field.hasAttribute("required") ||
                field.getAttribute("aria-required") === "true",
              tag,
              selector: selectorOf(field),
            };
          });

          const buttons = Array.from(
            form.querySelectorAll(
              'button, input[type="submit"], input[type="button"], [role="button"]',
            ),
          ).map(buttonInfo);

          return {
            action: form.getAttribute("action"),
            method: form.getAttribute("method"),
            fields,
            buttons,
            hasLiveRegion:
              form.querySelector(
                '[aria-live], [role="status"], [role="alert"], [role="log"], output',
              ) !== null,
            selector: selectorOf(form),
          };
        },
      );

      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"]'),
      )
        .filter((el) => el.closest("form") === null)
        .map(buttonInfo);

      const headings = Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
      ).map((el) => ({
        level: Number.parseInt(el.tagName.substring(1), 10),
        text: visibleTextOf(el),
      }));

      const images = Array.from(document.images).map((img) => ({
        src: img.getAttribute("src") ?? img.src ?? "",
        alt: img.getAttribute("alt"),
        width: img.naturalWidth || toDimension(img.getAttribute("width")),
        height: img.naturalHeight || toDimension(img.getAttribute("height")),
      }));

      const feedbackSet = new Set<string>();
      for (const el of Array.from(
        document.querySelectorAll(
          '[aria-live], [role="status"], [role="alert"], [role="dialog"], [role="log"], dialog, output',
        ),
      )) {
        const live = el.getAttribute("aria-live");
        if (live !== null) feedbackSet.add(`aria-live=${live}`);
        const role = el.getAttribute("role");
        if (role !== null) feedbackSet.add(`role=${role}`);
        const id = el.getAttribute("id");
        if (id !== null && id.length > 0) feedbackSet.add(`id=${id}`);
      }

      const stateAttrs: string[] = [];
      for (const name of [
        "aria-expanded",
        "aria-selected",
        "aria-checked",
        "aria-disabled",
        "aria-pressed",
        "aria-current",
        "disabled",
        "checked",
        "selected",
      ]) {
        if (document.querySelector(`[${name}]`) !== null) stateAttrs.push(name);
      }

      return {
        title: document.title,
        lang: document.documentElement.lang || null,
        description: descriptionEl?.getAttribute("content") ?? null,
        canonical: canonicalEl?.getAttribute("href") ?? null,
        jsonLd,
        links,
        forms,
        buttons,
        headings,
        landmarks: {
          main: document.querySelector("main") !== null,
          header: document.querySelector("header") !== null,
          nav: document.querySelector("nav") !== null,
          footer: document.querySelector("footer") !== null,
        },
        images,
        canvasCount: document.querySelectorAll("canvas").length,
        iframeCount: document.querySelectorAll("iframe").length,
        ariaLiveCount: document.querySelectorAll(
          '[aria-live], [role="status"], [role="log"]',
        ).length,
        ariaDialogCount: document.querySelectorAll('[role="dialog"], dialog')
          .length,
        ariaAlertCount: document.querySelectorAll('[role="alert"]').length,
        feedbackSurfaces: Array.from(feedbackSet),
        stateAttrs,
        text,
        visibleText,
        renderedHtml: document.documentElement.outerHTML,
      };
    });

    const dom = DomSchema.parse(domRaw);
    const clsRaw: unknown = await page.evaluate(() =>
      Reflect.get(globalThis, "__offscriptCls"),
    );
    const cls =
      typeof clsRaw === "number" && Number.isFinite(clsRaw) ? clsRaw : 0;
    const rawHtml =
      opts.allowJs === false
        ? dom.renderedHtml
        : await fetchRawHtml(browser, targetUrl);

    return {
      url: page.url() || targetUrl,
      status: response?.status() ?? 0,
      contentType: response?.headers()["content-type"] ?? "",
      headers: response?.headers() ?? {},
      rawHtml,
      renderedHtml: dom.renderedHtml,
      text: dom.text,
      visibleText: dom.visibleText,
      title: dom.title,
      lang: dom.lang,
      description: dom.description,
      canonical: dom.canonical,
      jsonLd: dom.jsonLd,
      links: dom.links,
      forms: dom.forms,
      buttons: dom.buttons,
      headings: dom.headings,
      images: dom.images,
      landmarks: dom.landmarks,
      canvasCount: dom.canvasCount,
      iframeCount: dom.iframeCount,
      ariaLiveCount: dom.ariaLiveCount,
      ariaDialogCount: dom.ariaDialogCount,
      ariaAlertCount: dom.ariaAlertCount,
      feedbackSurfaces: dom.feedbackSurfaces,
      stateAttrs: dom.stateAttrs,
      pageErrors,
      cls,
      settledMs,
      bodyHash: createHash("sha256").update(dom.visibleText).digest("hex"),
    } satisfies PageSnapshot;
  } finally {
    await context.close();
  }
}

/** Re-fetch the same URL with JavaScript disabled to capture server HTML. */
async function fetchRawHtml(browser: Browser, rawUrl: string): Promise<string> {
  const context: BrowserContext = await browser.newContext({
    serviceWorkers: "block",
    userAgent: USER_AGENT,
    javaScriptEnabled: false,
  });
  try {
    const page = await context.newPage();
    await page.goto(rawUrl, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
    return await page.content();
  } catch {
    return "";
  } finally {
    await context.close();
  }
}
