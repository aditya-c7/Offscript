import { z } from "zod";

export const SiteSchema = z.object({
  id: z.string(),
  host: z.string(),
  url: z.string(),
  detectedStack: z.string(),
  lastScanAt: z.string().nullable(),
  scoreOverall: z.number().nullable(),
  find: z.number().nullable(),
  understand: z.number().nullable(),
  act: z.number().nullable(),
  latestVerdict: z.string().nullable(),
  checksPassed: z.number(),
  checksTotal: z.number(),
  topFixes: z.array(z.string()).optional(),
});

export type SiteSummary = z.infer<typeof SiteSchema>;
