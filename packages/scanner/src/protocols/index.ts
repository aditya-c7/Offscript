/** Protocol / standards detectors, in PROTOCOL_KEYS order. */
import {
  PROTOCOL_KEYS,
  type ProtocolKey,
  type ProtocolResult,
  type ScanContext,
} from "@offscript/shared";
import { detectA2a } from "./a2a.js";
import { detectContentSignals } from "./content-signals.js";
import { detectLlmsTxt } from "./llms-txt.js";
import { detectMarkdownNegotiation } from "./markdown-negotiation.js";
import { detectMcp } from "./mcp.js";
import { detectOpenApi } from "./openapi.js";
import { detectWebMcp } from "./webmcp.js";

export {
  detectA2a,
  detectContentSignals,
  detectLlmsTxt,
  detectMarkdownNegotiation,
  detectMcp,
  detectOpenApi,
  detectWebMcp,
};

const DETECTORS: Record<ProtocolKey, (ctx: ScanContext) => ProtocolResult> = {
  llms_txt: detectLlmsTxt,
  mcp: detectMcp,
  webmcp: detectWebMcp,
  a2a: detectA2a,
  openapi: detectOpenApi,
  markdown_negotiation: detectMarkdownNegotiation,
  content_signals: detectContentSignals,
};

/** Detect all seven agent protocols from already-collected observations. */
export function detectProtocols(ctx: ScanContext): ProtocolResult[] {
  return PROTOCOL_KEYS.map((key) => DETECTORS[key](ctx));
}
