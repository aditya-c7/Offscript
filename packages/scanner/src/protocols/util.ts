/** Read-only helpers for interpreting already-collected protocol probes. */
import type { ScanContext } from "@offscript/shared";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Look up a probe result by any of its plausible spellings. */
export function rawValue(ctx: ScanContext, keys: readonly string[]): unknown {
  const raw = ctx.protocolsRaw ?? {};
  for (const wanted of keys) {
    const lowered = wanted.toLowerCase();
    for (const [key, value] of Object.entries(raw)) {
      if (key.toLowerCase() === lowered) return value;
    }
  }
  return undefined;
}

export function rawRecord(
  ctx: ScanContext,
  keys: readonly string[],
): Record<string, unknown> | null {
  const value = rawValue(ctx, keys);
  return isRecord(value) ? value : null;
}

export function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

/** Tri-state presence from the many shapes a raw probe can take. */
export function rawPresence(
  ctx: ScanContext,
  keys: readonly string[],
): boolean | null {
  const value = rawValue(ctx, keys);
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value >= 200 && value < 400;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    if (/^(404|403|not found|absent|none)$/i.test(trimmed)) return false;
    return true;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) {
    if (typeof value["found"] === "boolean") return value["found"];
    if (typeof value["present"] === "boolean") return value["present"];
    const status = asNumber(value["status"]);
    if (status !== null) return status >= 200 && status < 400;
    const body = value["body"] ?? value["text"] ?? value["content"];
    if (typeof body === "string") return body.trim().length > 0;
    return Object.keys(value).length > 0;
  }
  return null;
}

export function headerValue(
  headers: Record<string, string>,
  name: string,
): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

export function pageHtml(ctx: ScanContext): string {
  return ctx.pages
    .flatMap((page) => [page.rawHtml ?? "", page.renderedHtml ?? ""])
    .join("\n");
}
