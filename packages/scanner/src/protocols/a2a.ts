import type { ProtocolResult, ScanContext } from "@offscript/shared";
import { pageHtml, rawPresence } from "./util.js";

/** A2A agent card discovery. */
export function detectA2a(ctx: ScanContext): ProtocolResult {
  const presence = rawPresence(ctx, [
    "a2a",
    "agent_card",
    "agentcard",
    "agent-card",
    "agent.json",
  ]);
  const mentioned = /agent-card\.json|\.well-known\/agent|agent-card/i.test(
    pageHtml(ctx),
  );
  const found = presence === true;
  return {
    key: "a2a",
    found,
    detail: found
      ? "An A2A agent card was detected."
      : presence === false
        ? "The A2A agent-card probe did not return usable content."
        : mentioned
          ? "An agent-card path is referenced in HTML but no successful fetch was recorded."
          : "No A2A agent card was detected.",
    evidence: {
      probe_presence: presence,
      mentioned_in_html: mentioned,
      expected_paths: [
        "/.well-known/agent-card.json",
        "/.well-known/agent.json",
      ],
    },
  };
}
