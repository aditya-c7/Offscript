import { NextResponse } from "next/server";
import { z } from "zod";

const IpCandidateSchema = z.string().min(1).max(128);
const RateScopeSchema = z.string().min(1).max(64);

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Best-effort client identifier, validated as plain data. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? null;
  const candidate = first ?? request.headers.get("x-real-ip") ?? "local";
  const parsed = IpCandidateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : "local";
}

/**
 * Stateless POST guard.
 *
 * Rate limiting is enforced at the edge on Workers. An isolate-local `Map`
 * is not shared between requests, holds long-lived process state, and gives a
 * false sense of protection, so it is deliberately not used here. This helper
 * only validates inputs and returns `null` (i.e. "no local rejection"); edge
 * throttling remains authoritative.
 */
export function limitPost(
  request: Request,
  scope: string,
): NextResponse | null {
  if (!IpCandidateSchema.safeParse(clientIp(request)).success) {
    return jsonError("Invalid request.", 400);
  }
  if (!RateScopeSchema.safeParse(scope).success) {
    return jsonError("Invalid request.", 400);
  }
  return null;
}

type ParseResult<S extends z.ZodType<unknown>> =
  { ok: true; data: z.output<S> } | { ok: false; response: NextResponse };

/** Parse and validate a JSON body without ever surfacing parser internals. */
export async function parseJsonBody<S extends z.ZodType<unknown>>(
  request: Request,
  schema: S,
): Promise<ParseResult<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError("Invalid JSON body.", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Never echo the body, Zod issues, or header values (which may carry
    // tokens) back to the caller or into logs.
    return { ok: false, response: jsonError("Invalid request body.", 400) };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Log only a static context label and the error's class name. Never logs the
 * error message, stack, request bodies, headers, env vars, or secrets.
 */
export function logServerError(context: string, error: unknown): void {
  console.error(
    `[offscript] ${context}`,
    error instanceof Error ? error.name : "unknown",
  );
}
