import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";

const IpCandidateSchema = z.string().min(1).max(128);

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Best-effort client identifier for the in-memory POST limiter. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? null;
  const candidate = first ?? request.headers.get("x-real-ip") ?? "local";
  const parsed = IpCandidateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : "local";
}

/** Returns a 429 response when the caller has exhausted a POST budget. */
export function limitPost(
  request: Request,
  scope: string,
): NextResponse | null {
  const allowed = checkRateLimit(
    `${scope}:${clientIp(request)}`,
    10,
    10 * 60 * 1000,
  );
  if (allowed) return null;
  return jsonError(
    "Too many requests. Please try again in a few minutes.",
    429,
  );
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
    return { ok: false, response: jsonError("Invalid request body.", 400) };
  }
  return { ok: true, data: parsed.data };
}

export function logServerError(context: string, error: unknown): void {
  console.error(
    `[offscript] ${context}`,
    error instanceof Error ? error.name : "unknown",
  );
}
