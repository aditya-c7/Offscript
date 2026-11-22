import { z } from "zod";

export const SCAN_QUEUE = "scan.site";
export const ANALYSIS_QUEUE = "agent.run";

const DEFAULT_ENQUEUE_URL = "http://localhost:8787/enqueue";

/**
 * The web app runs on Cloudflare Workers: it must never open a database
 * connection here. Queueing is a one-way HTTP POST to the local Node worker.
 */
const EnqueueUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "enqueue URL must use http(s)",
  );
const IdSchema = z.string().uuid();
/** Shared worker secret; blank/whitespace values count as missing. */
const EnqueueTokenSchema = z.string().trim().min(1);

const EnqueueRequestSchema = z.discriminatedUnion("queue", [
  z.object({
    queue: z.literal(SCAN_QUEUE),
    payload: z.object({ scanId: IdSchema }),
  }),
  z.object({
    queue: z.literal(ANALYSIS_QUEUE),
    payload: z.object({ analysisId: IdSchema }),
  }),
]);

type EnqueueRequest = z.infer<typeof EnqueueRequestSchema>;

function enqueueUrl(): string {
  const raw =
    typeof process === "undefined" ? undefined : process.env.WORKER_ENQUEUE_URL;
  const parsed = EnqueueUrlSchema.safeParse(raw || DEFAULT_ENQUEUE_URL);
  return parsed.success ? parsed.data : DEFAULT_ENQUEUE_URL;
}

/**
 * Read the shared secret from the environment. It is only ever placed in the
 * Authorization header; it is never logged or included in the enqueue URL.
 */
function enqueueToken(): string {
  const raw =
    typeof process === "undefined"
      ? undefined
      : process.env.WORKER_ENQUEUE_TOKEN;
  const parsed = EnqueueTokenSchema.safeParse(raw);
  return parsed.success ? parsed.data : "";
}

function requestHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token.length > 0) headers.authorization = `Bearer ${token}`;
  return headers;
}

/** Never include the URL, the token, the payload, or any env value in logs. */
function logFailure(error: unknown): void {
  console.error(
    "[offscript] queue enqueue failed",
    error instanceof Error ? error.name : "unknown",
  );
}

function logMissingToken(): void {
  console.warn("[offscript] queue enqueue missing worker token");
}

async function post(request: EnqueueRequest): Promise<void> {
  try {
    const body = EnqueueRequestSchema.parse(request);
    const token = enqueueToken();
    if (token.length === 0) {
      // Fail closed: without the shared secret the worker answers 401, so no
      // job is ever enqueued. Surface the misconfiguration for operators.
      logMissingToken();
    }
    const response = await fetch(enqueueUrl(), {
      method: "POST",
      headers: requestHeaders(token),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = new Error("enqueue request rejected");
      error.name = "EnqueueHttpError";
      throw error;
    }
  } catch (error: unknown) {
    logFailure(error);
  }
}

export async function enqueueScan(scanId: string): Promise<void> {
  if (!IdSchema.safeParse(scanId).success) return;
  await post({ queue: SCAN_QUEUE, payload: { scanId } });
}

export async function enqueueAnalysis(analysisId: string): Promise<void> {
  if (!IdSchema.safeParse(analysisId).success) return;
  await post({ queue: ANALYSIS_QUEUE, payload: { analysisId } });
}
