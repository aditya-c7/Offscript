import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb,
  DbDriverSchema,
  getDb,
  getDbDriver,
  getPool,
  withTransaction,
} from "./client.js";

const FAKE_DATABASE_URL = "postgres://user:pass@localhost:5432/offscript_test";

describe("DB_DRIVER validation", () => {
  afterEach(() => {
    delete process.env.DB_DRIVER;
  });

  it("defaults to node when unset", () => {
    delete process.env.DB_DRIVER;
    expect(getDbDriver()).toBe("node");
  });

  it("accepts node and neon-http", () => {
    process.env.DB_DRIVER = "node";
    expect(getDbDriver()).toBe("node");
    process.env.DB_DRIVER = "neon-http";
    expect(getDbDriver()).toBe("neon-http");
  });

  it("rejects unknown drivers", () => {
    process.env.DB_DRIVER = "sqlite";
    expect(() => getDbDriver()).toThrow();
    expect(DbDriverSchema.safeParse("sqlite").success).toBe(false);
  });
});

describe("driver selection (offline, no database connection)", () => {
  const originalDriver = process.env.DB_DRIVER;
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = FAKE_DATABASE_URL;
  });

  afterEach(async () => {
    await closeDb();
    if (originalDriver === undefined) {
      delete process.env.DB_DRIVER;
    } else {
      process.env.DB_DRIVER = originalDriver;
    }
    if (originalUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalUrl;
    }
  });

  it("uses a node Pool by default and caches one handle", () => {
    delete process.env.DB_DRIVER;
    const pool = getPool();
    expect(pool).toBeInstanceOf(Pool);
    expect(getPool()).toBe(pool);

    const db = getDb();
    expect(getDb()).toBe(db);
    expect(typeof db.select).toBe("function");
  });

  it("uses neon-http with no Pool and no module-level connection", () => {
    process.env.DB_DRIVER = "neon-http";
    const db = getDb();
    expect(getDb()).toBe(db);
    expect(typeof db.select).toBe("function");
    expect(typeof db.insert).toBe("function");
    expect(() => getPool()).toThrow(/neon-http/);
  });

  it("rejects transactions on neon-http with a clear error", async () => {
    process.env.DB_DRIVER = "neon-http";
    await expect(
      withTransaction(async () => {
        throw new Error("callback must not run");
      }),
    ).rejects.toThrow(/neon-http/);
  });

  it("does not leak a node pool into the neon-http path", async () => {
    delete process.env.DB_DRIVER;
    getPool();
    await closeDb();

    process.env.DB_DRIVER = "neon-http";
    getDb();
    expect(() => getPool()).toThrow(/neon-http/);
  });
});
