import { getOrCreateQuota } from "@offscript/db";
import { z } from "zod";

const NumberSchema = z.number().int().nonnegative();
const RowWithCamel = z.object({ analysesRemaining: z.number() });
const RowWithSnake = z.object({ analyses_remaining: z.number() });
const RowWithRemaining = z.object({ remaining: z.number() });

/**
 * The quota helper returns a remaining count. Tolerate also receiving a quota
 * row at this boundary so routes never depend on its representation.
 */
export async function getRemainingQuota(ownerId: string): Promise<number> {
  const raw: unknown = await getOrCreateQuota(ownerId);

  const direct = NumberSchema.safeParse(raw);
  if (direct.success) return direct.data;

  const camel = RowWithCamel.safeParse(raw);
  if (camel.success) return camel.data.analysesRemaining;

  const snake = RowWithSnake.safeParse(raw);
  if (snake.success) return snake.data.analyses_remaining;

  const remaining = RowWithRemaining.safeParse(raw);
  if (remaining.success) return remaining.data.remaining;

  return 0;
}

/*
 * Transactional writes (row creation + credit settlement) live on the Node
 * worker, which has a real interactive-transaction database connection. The
 * web app runs on neon-http and must only proxy these calls over HTTP.
 */

const WorkerBaseUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "worker URL must use http(s)",
  );
const WorkerIdSchema = z.object({ id: z.string().uuid() });
const EnqueueTokenSchema = z.string().trim().min(1);

function workerHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const raw =
    typeof process === "undefined"
      ? undefined
      : process.env.WORKER_ENQUEUE_TOKEN;
  const parsed = EnqueueTokenSchema.safeParse(raw);
  if (parsed.success) headers.authorization = `Bearer ${parsed.data}`;
  return headers;
}

/** Never log the URL, the payload, or any env value. */
function workerFailure(name: string, error: unknown): Error {
  console.error(
    `[offscript] worker request failed`,
    error instanceof Error && error.name.length > 0 ? error.name : name,
  );
  const failure = new Error(name);
  failure.name = name;
  return failure;
}

function workerBaseUrl(): string | null {
  const raw =
    typeof process === "undefined" ? undefined : process.env.WORKER_ENQUEUE_URL;
  const parsed = WorkerBaseUrlSchema.safeParse(raw ?? "");
  if (!parsed.success) return null;

  // Accept both a bare base ("http://host:8787") and the legacy full enqueue
  // URL ("http://host:8787/enqueue") used by the existing enqueue client.
  let base = parsed.data.replace(/\/+$/, "");
  if (base.endsWith("/enqueue")) {
    base = base.slice(0, -"/enqueue".length).replace(/\/+$/, "");
  }
  return base.length > 0 ? base : null;
}

/**
 * POST a create/re-run command to the Node worker and return its generated id.
 * The boundary is validated with Zod; failures never expose URLs or payloads.
 */
export async function createWorkerJob(
  path: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const base = workerBaseUrl();
  if (!base) throw workerFailure("InvalidWorkerUrl", undefined);

  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw workerFailure("WorkerHttpError", undefined);

    const raw: unknown = await response.json();
    const parsed = WorkerIdSchema.safeParse(raw);
    if (!parsed.success) throw workerFailure("WorkerResponseError", undefined);
    return parsed.data.id;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.name === "InvalidWorkerUrl" ||
        error.name === "WorkerHttpError" ||
        error.name === "WorkerResponseError")
    ) {
      throw error;
    }
    throw workerFailure("WorkerRequestError", error);
  }
}
