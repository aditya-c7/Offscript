import { z } from "zod";

const CreateScanResponseSchema = z
  .object({
    id: z.string().optional(),
    scanId: z.string().optional(),
    scan: z.object({ id: z.string() }).optional(),
  })
  .passthrough();

const ErrorBodySchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export function errorMessageFrom(raw: unknown): string | null {
  const parsed = ErrorBodySchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.error ?? parsed.data.message ?? null;
}

export function scanIdFrom(raw: unknown): string | null {
  const parsed = CreateScanResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.id ?? parsed.data.scanId ?? parsed.data.scan?.id ?? null;
}
