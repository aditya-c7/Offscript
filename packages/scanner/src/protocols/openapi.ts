import type { ProtocolResult, ScanContext } from "@offscript/shared";
import { pageHtml, rawPresence } from "./util.js";

/** OpenAPI / Swagger description discovery. */
export function detectOpenApi(ctx: ScanContext): ProtocolResult {
  const presence = rawPresence(ctx, [
    "openapi",
    "openapi_json",
    "openapi.json",
    "swagger",
    "swagger.json",
  ]);
  const mentioned =
    /\/openapi\.json|\/swagger(?:\.json|\/)|openapi:|"openapi"\s*:/i.test(
      pageHtml(ctx),
    );
  const found = presence === true;
  return {
    key: "openapi",
    found,
    detail: found
      ? "An OpenAPI description was detected."
      : presence === false
        ? "The OpenAPI probe did not return a usable document."
        : mentioned
          ? "An OpenAPI document is referenced in HTML but no successful fetch was recorded."
          : "No OpenAPI description was detected.",
    evidence: {
      probe_presence: presence,
      mentioned_in_html: mentioned,
      expected_paths: ["/openapi.json", "/swagger.json"],
    },
  };
}
