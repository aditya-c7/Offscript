import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "playwright";
import { z } from "zod";
import {
  ObservationHeadingSchema,
  ObservationNavSchema,
  ObservationNodeSchema,
} from "@offscript/shared";
import type { ObservationTarget, ObservationV2 } from "@offscript/shared";
import { maskSensitiveInputs, redactObject } from "./pii-redactor.js";

type ObservationHeading = z.infer<typeof ObservationHeadingSchema>;
type ObservationNav = z.infer<typeof ObservationNavSchema>;
type ObservationNode = z.infer<typeof ObservationNodeSchema>;

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                  */
/* ------------------------------------------------------------------ */

const SCHEMA = "offscript.observation/v2" as const;
const MAX_CONTENT_CHARS = 24_000;
const MAX_NODES = 800;
const MAX_TARGETS = 200;

export function computeStateToken(text: string, url: string): string {
  return createHash("sha256")
    .update(text, "utf8")
    .update("\u0000", "utf8")
    .update(url, "utf8")
    .digest("hex");
}

function shortHash(
  role: string,
  name: string,
  destination: string | null,
): string {
  return createHash("sha256")
    .update(`${role}\u0000${name}\u0000${destination ?? ""}`, "utf8")
    .digest("hex")
    .slice(0, 8);
}

/** Randomized per-run delimiters for wrapping untrusted model input. */
export function nonceTag(label: string): { open: string; close: string } {
  const safeLabel =
    label.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase() || "CONTENT";
  const name = `UNTRUSTED_${safeLabel}_${randomBytes(8).toString("hex")}`;
  return { open: `<${name}>`, close: `</${name}>` };
}

/* ------------------------------------------------------------------ */
/* Raw DOM snapshot types                                               */
/* ------------------------------------------------------------------ */

type RawHeading = ObservationHeading;
type RawNav = ObservationNav;
interface RawNode {
  role: string;
  name: string;
  depth: number;
}
interface RawTarget {
  role: string;
  name: string;
  destination: string | null;
  enabled: boolean;
  checked?: boolean;
  expanded?: boolean;
  value?: string;
}
interface RawSnapshot {
  bodyText: string;
  headings: RawHeading[];
  navigation: RawNav[];
  nodes: RawNode[];
  targets: RawTarget[];
  omitted: string[];
}

const EMPTY_SNAPSHOT: RawSnapshot = {
  bodyText: "",
  headings: [],
  navigation: [],
  nodes: [],
  targets: [],
  omitted: [],
};

/* ------------------------------------------------------------------ */
/* Observation capture                                                  */
/* ------------------------------------------------------------------ */

export async function captureObservation(
  page: Page,
  opts?: { publicSearchTargetId?: string | null },
): Promise<ObservationV2> {
  const errors: string[] = [];
  let url = "";
  try {
    url = page.url();
  } catch {
    // Page already closed; keep the empty URL.
  }
  const title = await page.title().catch(() => "");

  let raw: RawSnapshot = EMPTY_SNAPSHOT;
  try {
    raw = await page.evaluate((): RawSnapshot => {
      const TARGET_SELECTOR = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "summary",
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="tab"]',
        '[role="combobox"]',
        '[role="textbox"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[contenteditable="true"]',
      ].join(",");

      const NODE_SELECTOR = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "h1,h2,h3,h4,h5,h6",
        "nav",
        "main",
        "header",
        "footer",
        "article",
        "section",
        "li",
        "[role]",
      ].join(",");

      const collapse = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();

      const accessibleName = (element: Element): string => {
        const ariaLabel = collapse(element.getAttribute("aria-label"));
        if (ariaLabel) return ariaLabel;

        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const parts = labelledBy
            .split(/\s+/)
            .map((id) => collapse(document.getElementById(id)?.textContent))
            .filter((part) => part.length > 0);
          if (parts.length > 0) return parts.join(" ");
        }

        const titleText = collapse(element.getAttribute("title"));
        if (titleText) return titleText;

        if (element instanceof HTMLInputElement) {
          if (
            element.type === "submit" ||
            element.type === "button" ||
            element.type === "reset"
          ) {
            return collapse(element.value);
          }
          return collapse(element.getAttribute("placeholder"));
        }

        const alt = collapse(element.getAttribute("alt"));
        if (alt) return alt;
        return collapse(element.textContent);
      };

      const inferRole = (element: Element): string => {
        const explicit = collapse(element.getAttribute("role"));
        if (explicit) return explicit;
        if (element instanceof HTMLAnchorElement) {
          return element.hasAttribute("href") ? "link" : "generic";
        }
        if (element instanceof HTMLButtonElement) return "button";
        if (element instanceof HTMLInputElement) {
          if (element.type === "checkbox") return "checkbox";
          if (element.type === "radio") return "radio";
          if (
            element.type === "submit" ||
            element.type === "button" ||
            element.type === "reset"
          ) {
            return "button";
          }
          return "textbox";
        }
        if (element instanceof HTMLTextAreaElement) return "textbox";
        if (element instanceof HTMLSelectElement) return "combobox";
        if (element instanceof HTMLElement && element.isContentEditable) {
          return "textbox";
        }
        if (element.tagName.toLowerCase() === "summary") return "button";
        return "generic";
      };

      const depthOf = (element: Element): number => {
        let depth = 0;
        let parent = element.parentElement;
        while (parent !== null && parent !== document.body) {
          depth += 1;
          parent = parent.parentElement;
        }
        return depth;
      };

      const headings: RawHeading[] = [];
      document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((element) => {
        const text = collapse(element.textContent);
        if (text.length === 0) return;
        const level = Number(element.tagName.substring(1));
        if (level >= 1 && level <= 6) headings.push({ level, text });
      });

      const navigation: RawNav[] = [];
      document
        .querySelectorAll('nav a, [role="navigation"] a')
        .forEach((element) => {
          const text = collapse(element.textContent);
          const href =
            element instanceof HTMLAnchorElement
              ? element.getAttribute("href")
              : null;
          navigation.push({ text, href });
        });

      const omitted: string[] = [];
      const nodes: RawNode[] = [];
      document.querySelectorAll(NODE_SELECTOR).forEach((element) => {
        if (nodes.length >= 800) {
          omitted.push(`node:${inferRole(element)}:${accessibleName(element)}`);
          return;
        }
        nodes.push({
          role: inferRole(element),
          name: accessibleName(element),
          depth: depthOf(element),
        });
      });

      const targets: RawTarget[] = [];
      document.querySelectorAll(TARGET_SELECTOR).forEach((element) => {
        if (targets.length >= 200) {
          omitted.push(
            `target:${inferRole(element)}:${accessibleName(element)}`,
          );
          return;
        }

        element.setAttribute("data-offscript-target", String(targets.length));
        const role = inferRole(element);
        const name = accessibleName(element);
        let destination: string | null = null;
        if (element instanceof HTMLAnchorElement) {
          destination =
            element.getAttribute("href") === null ? null : element.href;
        }

        const isDisabled =
          element.getAttribute("aria-disabled") === "true" ||
          (element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLButtonElement
            ? element.disabled
            : false);

        const target: RawTarget = {
          role,
          name,
          destination,
          enabled: !isDisabled,
        };

        const ariaChecked = element.getAttribute("aria-checked");
        if (ariaChecked === "true" || ariaChecked === "false") {
          target.checked = ariaChecked === "true";
        }
        const ariaExpanded = element.getAttribute("aria-expanded");
        if (ariaExpanded === "true" || ariaExpanded === "false") {
          target.expanded = ariaExpanded === "true";
        }

        if (element instanceof HTMLInputElement) {
          if (element.type === "checkbox" || element.type === "radio") {
            target.checked = element.checked;
          }
          const autocomplete = (
            element.getAttribute("autocomplete") ?? ""
          ).toLowerCase();
          const isSensitive =
            element.type === "password" ||
            autocomplete.includes("cc-") ||
            autocomplete.includes("current-password") ||
            autocomplete.includes("one-time-code") ||
            autocomplete.includes("cvv") ||
            autocomplete.includes("otp");
          if (
            !isSensitive &&
            /^(text|search|email|tel|url|number)$/.test(element.type)
          ) {
            target.value = element.value;
          }
        } else if (
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        ) {
          target.value = element.value;
        }

        targets.push(target);
      });

      return {
        bodyText: document.body?.innerText ?? "",
        headings,
        navigation,
        nodes,
        targets,
        omitted,
      };
    });
  } catch (error) {
    errors.push(
      `observation DOM capture failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const state_token = computeStateToken(raw.bodyText, url);
  const contentTruncated = raw.bodyText.length > MAX_CONTENT_CHARS;
  const content = contentTruncated
    ? raw.bodyText.slice(0, MAX_CONTENT_CHARS)
    : raw.bodyText;

  const omitted_nodes = [...raw.omitted];
  if (contentTruncated) {
    omitted_nodes.unshift(
      `content: omitted ${raw.bodyText.length - MAX_CONTENT_CHARS} characters`,
    );
  }

  const nodes: ObservationNode[] = raw.nodes.map((node, idx) => ({
    id: `n_${shortHash(node.role, node.name, null)}_${idx}`,
    role: node.role,
    name: node.name,
    depth: node.depth,
  }));

  const targets: ObservationTarget[] = [];
  for (let idx = 0; idx < raw.targets.length; idx += 1) {
    const target = raw.targets[idx];
    if (target === undefined) continue;

    const box = await page
      .locator(`[data-offscript-target="${idx}"]`)
      .boundingBox()
      .catch(() => null);

    targets.push({
      id: `t_${shortHash(target.role, target.name, target.destination)}_${idx}`,
      role: target.role,
      name: target.name,
      destination: target.destination,
      state: {
        enabled: target.enabled,
        ...(target.checked === undefined ? {} : { checked: target.checked }),
        ...(target.expanded === undefined ? {} : { expanded: target.expanded }),
        ...(target.value === undefined ? {} : { value: target.value }),
      },
      bounds: {
        x: box?.x ?? 0,
        y: box?.y ?? 0,
        width: box?.width ?? 0,
        height: box?.height ?? 0,
      },
    });
  }

  await page
    .evaluate(() => {
      document
        .querySelectorAll("[data-offscript-target]")
        .forEach((element) => element.removeAttribute("data-offscript-target"));
    })
    .catch(() => {});

  const observation: ObservationV2 = {
    schema: SCHEMA,
    observation_id: randomUUID(),
    state_token,
    title,
    url,
    truncated: contentTruncated || omitted_nodes.length > 0,
    omitted_nodes,
    public_search_target_id: opts?.publicSearchTargetId ?? null,
    errors,
    content,
    headings: raw.headings,
    navigation: raw.navigation,
    nodes,
    targets,
  };

  const { value } = redactObject(observation);
  return value;
}

/* ------------------------------------------------------------------ */
/* Screenshot capture                                                   */
/* ------------------------------------------------------------------ */

export async function captureScreenshots(args: {
  page: Page;
  targets: ObservationTarget[];
  outDir: string;
  runId: string;
  idx: number;
}): Promise<{ numberedPath: string; finalPath: string }> {
  const { page, targets, outDir, runId, idx } = args;
  const runDir = join(outDir, runId);
  await mkdir(runDir, { recursive: true });

  const finalPath = join(runDir, `${idx}-final.webp`);
  const numberedPath = join(runDir, `${idx}-numbered.webp`);

  const unmask = await maskSensitiveInputs(page);
  let rawShot: Buffer;
  try {
    rawShot = await page.screenshot({ type: "webp", quality: 75 });
  } finally {
    await unmask();
  }

  const originalMeta = await sharp(rawShot).metadata();
  const originalWidth = originalMeta.width ?? 1280;

  const normalized = await sharp(rawShot)
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();

  const finalMeta = await sharp(normalized).metadata();
  const width = finalMeta.width ?? 1280;
  const height = finalMeta.height ?? 0;
  const scale = originalWidth > 0 ? width / originalWidth : 1;

  const badges = targets
    .map((target, targetIdx) => {
      const { x, y, width: boxWidth, height: boxHeight } = target.bounds;
      if (!(boxWidth > 0 && boxHeight > 0)) return "";
      const cx = (x + Math.min(boxWidth, 24) / 2) * scale;
      const cy = (y + Math.min(boxHeight, 24) / 2) * scale;
      const label = String(targetIdx + 1);
      return (
        `<circle cx="${cx}" cy="${cy}" r="12" fill="#2563eb" stroke="#ffffff" stroke-width="2"/>` +
        `<text x="${cx}" y="${cy}" fill="#ffffff" font-family="Arial,sans-serif" font-size="13" font-weight="bold" text-anchor="middle" dominant-baseline="central">${label}</text>`
      );
    })
    .join("");

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${badges}</svg>`,
    "utf8",
  );

  const numbered = await sharp(normalized)
    .composite([{ input: svg, top: 0, left: 0 }])
    .webp({ quality: 75 })
    .toBuffer();

  await Promise.all([
    writeFile(finalPath, normalized),
    writeFile(numberedPath, numbered),
  ]);

  return { numberedPath, finalPath };
}
