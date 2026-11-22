import { describe, expect, it } from "vitest";
import { createSemaphore, limitForMemory } from "./concurrency.js";

describe("limitForMemory", () => {
  it("allows one browser per 2 GB, clamped to 1..4", () => {
    expect(limitForMemory(2048)).toBe(1);
    expect(limitForMemory(4096)).toBe(2);
    expect(limitForMemory(6144)).toBe(3);
    expect(limitForMemory(8192)).toBe(4);
  });

  it("clamps large machines to four and floors partial slots", () => {
    expect(limitForMemory(20_480)).toBe(4);
    expect(limitForMemory(5000)).toBe(2);
    expect(limitForMemory(4095)).toBe(1);
  });

  it("never returns less than one for invalid or tiny values", () => {
    expect(limitForMemory(0)).toBe(1);
    expect(limitForMemory(512)).toBe(1);
    expect(limitForMemory(-1)).toBe(1);
    expect(limitForMemory(Number.NaN)).toBe(1);
  });
});

describe("createSemaphore", () => {
  it("rejects non-positive limits", () => {
    expect(() => createSemaphore(0)).toThrow(/positive integer/);
    expect(() => createSemaphore(-2)).toThrow(/positive integer/);
    expect(() => createSemaphore(1.5)).toThrow(/positive integer/);
  });

  it("tracks the active count across sequential acquire/release", async () => {
    const sem = createSemaphore(1);
    expect(sem.active).toBe(0);
    const release = await sem.acquire();
    expect(sem.active).toBe(1);
    release();
    expect(sem.active).toBe(0);
  });

  it("supports up to limit concurrent holders", async () => {
    const sem = createSemaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(sem.active).toBe(2);
    r1();
    expect(sem.active).toBe(1);
    r2();
    expect(sem.active).toBe(0);
  });

  it("makes double release a no-op", async () => {
    const sem = createSemaphore(1);
    const release = await sem.acquire();
    expect(sem.active).toBe(1);
    release();
    release();
    expect(sem.active).toBe(0);

    // A stale release must not disturb a later, unrelated holder.
    const release2 = await sem.acquire();
    expect(sem.active).toBe(1);
    release();
    expect(sem.active).toBe(1);
    release2();
    expect(sem.active).toBe(0);
  });

  it("queues waiters and releases them in FIFO order", async () => {
    const sem = createSemaphore(1);
    const first = await sem.acquire();
    const order: number[] = [];

    const p2 = sem.acquire().then((release) => {
      order.push(2);
      return release;
    });
    const p3 = sem.acquire().then((release) => {
      order.push(3);
      return release;
    });
    const p4 = sem.acquire().then((release) => {
      order.push(4);
      return release;
    });

    expect(sem.active).toBe(1);
    first();
    const r2 = await p2;
    expect(order).toEqual([2]);
    expect(sem.active).toBe(1);
    r2();
    const r3 = await p3;
    expect(order).toEqual([2, 3]);
    r3();
    const r4 = await p4;
    expect(order).toEqual([2, 3, 4]);
    r4();
    expect(sem.active).toBe(0);
  });

  it("hands a slot directly to a waiter without exceeding the limit", async () => {
    const sem = createSemaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    const pending = sem.acquire();
    expect(sem.active).toBe(2);

    r1();
    const r3 = await pending;
    expect(sem.active).toBe(2);
    r2();
    expect(sem.active).toBe(1);
    r3();
    expect(sem.active).toBe(0);
  });
});
