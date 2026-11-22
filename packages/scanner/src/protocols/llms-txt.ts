import type { ProtocolResult, ScanContext } from "@offscript/shared";
import { pageHtml, rawPresence } from "./util.js";

/** llms.txt / llms-full.txt discovery. */
export function detectLlmsTxt(ctx: ScanContext): ProtocolResult {
  const presence = rawPresence(ctx, [
    "llms_txt",
    "llmsTxt",
    "llms.txt",
    "llms-full.txt",
    "llms_full",
  ]);
  const mentioned = /\/llms(?:-full)?\.txt/i.test(pageHtml(ctx));
  const found = presence === true;
  return {
    key: "llms_txt",
    found,
    detail: found
      ? "An llms.txt-style guide was fetched successfully."
      : presence === false
        ? "The llms.txt probe did not return usable content."
        : mentioned
          ? "llms.txt is referenced in page HTML but no successful fetch was recorded."
          : "No llms.txt probe or reference was recorded.",
    evidence: {
      probe_presence: presence,
      mentioned_in_html: mentioned,
      expected_paths: ["/llms.txt", "/llms-full.txt"],
    },
  };
}
