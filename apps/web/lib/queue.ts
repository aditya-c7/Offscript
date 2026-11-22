import PgBoss from "pg-boss";
import { z } from "zod";

export const SCAN_QUEUE = "scan.site";
export const ANALYSIS_QUEUE = "agent.run";

const DatabaseUrlSchema = z.string().min(1);
const IdSchema = z.string().uuid();

let bossPromise: Promise<PgBoss> | null = null;

function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const parsed = DatabaseUrlSchema.safeParse(process.env.DATABASE_URL);
      if (!parsed.success) throw new Error("DATABASE_URL is not configured");
      const boss = new PgBoss(parsed.data);
      await boss.start();
      return boss;
    })().catch((error: unknown) => {
      bossPromise = null;
      throw error;
    });
  }
  return bossPromise;
}

async function send(queue: string, payload: object): Promise<void> {
  try {
    const boss = await getBoss();
    await boss.send(queue, payload);
  } catch (error: unknown) {
    // Never log the connection string or job payload.
    console.error(
      "[offscript] queue enqueue failed",
      queue,
      error instanceof Error ? error.name : "unknown",
    );
  }
}

export async function enqueueScan(scanId: string): Promise<void> {
  if (!IdSchema.safeParse(scanId).success) return;
  await send(SCAN_QUEUE, { scanId });
}

export async function enqueueAnalysis(analysisId: string): Promise<void> {
  if (!IdSchema.safeParse(analysisId).success) return;
  await send(ANALYSIS_QUEUE, { analysisId });
}
