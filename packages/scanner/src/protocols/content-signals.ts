import type { ProtocolResult, ScanContext } from "@offscript/shared";
import { headerValue } from "./util.js";

/** robots.txt Content-Signal and matching HTTP header parity. */
export function detectContentSignals(ctx: ScanContext): ProtocolResult {
  const robotsLine =
    (ctx.robotsTxt ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^content-signal\s*:/i.test(line)) ?? null;
  const robotsSignals = robotsLine
    ? robotsLine.replace(/^content-signal\s*:/i, "").trim()
    : null;

  const headerSignals: string[] = [];
  for (const headers of Object.values(ctx.headersByUrl ?? {})) {
    const value = headerValue(headers, "content-signal");
    if (value) headerSignals.push(value.trim());
  }
  for (const page of ctx.pages) {
    const value = headerValue(page.headers, "content-signal");
    if (value) headerSignals.push(value.trim());
  }
  const httpSignals = headerSignals[0] ?? null;

  const normalize = (value: string): string =>
    value.toLowerCase().replace(/\s+/g, "").replace(/,+/g, ",");
  const parity =
    robotsSignals !== null && httpSignals !== null
      ? normalize(robotsSignals) === normalize(httpSignals)
      : null;

  const found = robotsSignals !== null || httpSignals !== null;
  const trainMatch = (robotsSignals ?? httpSignals ?? "").match(
    /ai-train\s*=\s*(yes|no)/i,
  );
  const detail = !found
    ? "No Content-Signal directive was found in robots.txt or HTTP headers."
    : parity === true
      ? `Content-Signal is declared in robots.txt and matches the HTTP header (ai-train=${trainMatch?.[1] ?? "unknown"}).`
      : parity === false
        ? `Content-Signal appears in robots.txt and HTTP headers but the values differ (robots="${robotsSignals ?? ""}", header="${httpSignals ?? ""}").`
        : `Content-Signal was found in ${robotsSignals !== null ? "robots.txt only" : "HTTP headers only"}.`;

  return {
    key: "content_signals",
    found,
    detail,
    evidence: {
      robots_signals: robotsSignals,
      http_header_signals: httpSignals,
      header_occurrences: headerSignals.length,
      parity,
      ai_train: trainMatch?.[1]?.toLowerCase() ?? null,
    },
  };
}
