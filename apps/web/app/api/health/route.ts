// Dependency-free liveness probe for the Cloudflare edge Worker.
// Intentionally does NOT import the database, auth, cookies, or any LLM
// provider: it must answer even when those dependencies are unavailable.
// Force runtime evaluation so the response is never prerendered into a
// cached artifact at build time.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { status: "ok", service: "offscript" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
