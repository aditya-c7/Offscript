import type { ProtocolResult, ScanContext } from "@offscript/shared";
import { pageHtml, rawPresence } from "./util.js";

/** MCP server card discovery. */
export function detectMcp(ctx: ScanContext): ProtocolResult {
  const presence = rawPresence(ctx, [
    "mcp",
    "mcp_server_card",
    "server_card",
    "mcp.json",
    "mcp_card",
  ]);
  const mentioned =
    /\.well-known\/(?:mcp|mcp\.json|mcp\/server-card\.json)|mcp\/server-card/i.test(
      pageHtml(ctx),
    );
  const found = presence === true;
  return {
    key: "mcp",
    found,
    detail: found
      ? "An MCP server card was detected."
      : presence === false
        ? "The MCP server-card probe did not return usable content."
        : mentioned
          ? "A MCP card path is referenced in HTML but no successful fetch was recorded."
          : "No MCP server card was detected.",
    evidence: {
      probe_presence: presence,
      mentioned_in_html: mentioned,
      expected_paths: [
        "/.well-known/mcp/server-card.json",
        "/.well-known/mcp.json",
      ],
    },
  };
}
