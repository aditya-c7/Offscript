import type { ProtocolResult, ScanContext } from "@offscript/shared";
import { pageHtml, rawPresence } from "./util.js";

/** WebMCP / model-context tool declarations in the page. */
export function detectWebMcp(ctx: ScanContext): ProtocolResult {
  const presence = rawPresence(ctx, [
    "webmcp",
    "web_mcp",
    "web mcp",
    "model_context",
    "modelcontext",
  ]);
  const html = pageHtml(ctx);
  const mentioned =
    /webmcp/i.test(html) ||
    /navigator\.modelcontext/i.test(html) ||
    /type=["']application\/(?:webmcp|model-context)/i.test(html);
  const found = presence === true || (presence === null && mentioned);
  return {
    key: "webmcp",
    found,
    detail: found
      ? "The page exposes WebMCP/model-context tool declarations."
      : "No WebMCP tool declarations were detected.",
    evidence: {
      probe_presence: presence,
      html_mentions_webmcp: mentioned,
    },
  };
}
