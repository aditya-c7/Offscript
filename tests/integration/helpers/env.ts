import { z } from "zod";

const NonEmptySchema = z.string().min(1);

export interface IntegrationEnv {
  /** Validated only from the shell process environment. .env is never read. */
  readonly databaseUrl: string;
  /** Exact blocker when the suite cannot be run safely; null when runnable. */
  readonly blocker: string | null;
}

/**
 * Preflight gate.
 *
 * The task allows the existing Neon URL only when it is already exported in
 * the shell, and explicitly forbids reading `.env`. When it is absent we
 * report the blocker instead of starting any process or touching any row.
 */
export function readIntegrationEnv(source: NodeJS.ProcessEnv): IntegrationEnv {
  const parsed = NonEmptySchema.safeParse(source.DATABASE_URL);
  if (parsed.success) {
    return { databaseUrl: parsed.data, blocker: null };
  }
  return {
    databaseUrl: "",
    blocker:
      "DATABASE_URL is not present (or empty) in the shell environment. " +
      "This suite never reads .env. Export DATABASE_URL from the shell " +
      "before running it; no live verification was performed.",
  };
}
