import { z } from "zod";

export interface JsonResponse<S extends z.ZodTypeAny> {
  readonly status: number;
  /** Parsed only when the response body validates against `schema`. */
  readonly data: z.infer<S> | null;
}

const TIMEOUT_MS = 15_000;

/**
 * All HTTP responses are external boundaries: parse as unknown, validate with
 * Zod, and never carry an unvalidated value into an assertion.
 */
export async function requestJson<S extends z.ZodTypeAny>(
  url: string,
  init: RequestInit,
  schema: S,
): Promise<JsonResponse<S>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (text.length === 0) return { status: response.status, data: null };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: response.status, data: null };
  }
  const parsed = schema.safeParse(json);
  return {
    status: response.status,
    data: parsed.success ? parsed.data : null,
  };
}

/** Stable anonymous owner cookie used for every web request in the suite. */
export function ownerCookie(ownerId: string): string {
  return `offscript_uid=${ownerId}`;
}
