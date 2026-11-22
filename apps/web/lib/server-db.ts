import { getDb as getOffscriptDb } from "@offscript/db";
import { z } from "zod";

/** Drizzle handle owned by @offscript/db (single source of truth). */
export function getServerDb(): ReturnType<typeof getOffscriptDb> {
  return getOffscriptDb();
}

const StorageDirSchema = z.string().min(1);

/** Resolved artifact storage root, validated without ever logging its value. */
export function getStorageDir(): string {
  const parsed = StorageDirSchema.safeParse(
    process.env.STORAGE_DIR ?? "./storage",
  );
  return parsed.success ? parsed.data : "./storage";
}
