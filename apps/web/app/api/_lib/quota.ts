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
