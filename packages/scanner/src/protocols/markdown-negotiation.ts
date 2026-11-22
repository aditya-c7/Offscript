import type { ProtocolResult, ScanContext } from "@offscript/shared";
import {
  asNumber,
  asString,
  headerValue,
  rawRecord,
  rawValue,
} from "./util.js";

/**
 * Markdown negotiation is only a pass when the markdown response, the
 * `Vary: Accept` header AND the nonexistent-markdown probe all line up.
 */
export function detectMarkdownNegotiation(ctx: ScanContext): ProtocolResult {
  const probe = rawRecord(ctx, [
    "markdown",
    "markdown_negotiation",
    "markdownNegotiation",
    "markdown_content",
  ]);
  const rawStatus =
    asNumber(probe?.["status"]) ??
    asNumber(rawValue(ctx, ["markdown_status", "markdownStatus"]));
  const rawContentType =
    asString(probe?.["contentType"]) ??
    asString(probe?.["content_type"]) ??
    asString(rawValue(ctx, ["markdown_content_type", "markdownContentType"]));
  const rawVary =
    asString(probe?.["vary"]) ??
    asString(rawValue(ctx, ["markdown_vary", "markdownVary"]));
  const probeStatus =
    asNumber(probe?.["notFoundStatus"]) ??
    asNumber(probe?.["probe_404_status"]) ??
    asNumber(
      rawValue(ctx, [
        "markdown_404_status",
        "markdown_probe_status",
        "nonexistent_md_status",
        "markdown_missing_status",
      ]),
    );

  let headerStatus: number | null = null;
  let headerContentType: string | null = null;
  let headerVary: string | null = null;
  for (const headers of Object.values(ctx.headersByUrl ?? {})) {
    const contentType = headerValue(headers, "content-type");
    if (contentType && /markdown/i.test(contentType)) {
      headerStatus = 200;
      headerContentType = contentType;
      headerVary = headerValue(headers, "vary");
      break;
    }
  }
  if (headerContentType === null) {
    for (const page of ctx.pages) {
      if (/markdown/i.test(page.contentType)) {
        headerStatus = page.status;
        headerContentType = page.contentType;
        headerVary = headerValue(page.headers, "vary");
        break;
      }
    }
  }

  const status = rawStatus ?? headerStatus;
  const contentType = rawContentType ?? headerContentType;
  const vary = rawVary ?? headerVary;
  const contentTypeOk =
    status === 200 &&
    contentType !== null &&
    /markdown|text\/plain/i.test(contentType);
  const varyAccept = vary !== null && /accept/i.test(vary);
  const probeOk =
    probeStatus === null ||
    probeStatus === 404 ||
    probeStatus === 410 ||
    probeStatus === 406;
  const found = contentTypeOk && varyAccept && probeOk;

  const missing: string[] = [];
  if (!contentTypeOk)
    missing.push(
      "Accept: text/markdown did not return a markdown body with 200",
    );
  if (!varyAccept) missing.push("Vary: Accept was not observed");
  if (!probeOk)
    missing.push(
      `nonexistent .md probe returned ${String(probeStatus)} instead of 404/410/406`,
    );

  return {
    key: "markdown_negotiation",
    found,
    detail: found
      ? "Markdown negotiation responds with text/markdown, varies on Accept and returns a real 404 for missing markdown pages."
      : `Markdown negotiation is incomplete: ${missing.join("; ")}.`,
    evidence: {
      status,
      content_type: contentType,
      vary,
      markdown_404_probe_status: probeStatus,
      content_type_ok: contentTypeOk,
      vary_accept: varyAccept,
      probe_ok: probeOk,
      source:
        rawStatus !== null || rawContentType !== null
          ? "protocolsRaw"
          : "headersByUrl",
    },
  };
}
