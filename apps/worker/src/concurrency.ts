/**
 * One browser per 2 GB of RAM, clamped to the 1..4 range. Invalid or tiny
 * values collapse to a single slot.
 */
export function limitForMemory(memoryMb: number): number {
  if (!Number.isFinite(memoryMb) || memoryMb <= 0) return 1;
  const raw = Math.floor(memoryMb / 2048);
  return Math.max(1, Math.min(4, raw));
}

export interface Semaphore {
  acquire(): Promise<() => void>;
  readonly active: number;
}

interface Waiter {
  resolve: (release: () => void) => void;
}

/**
 * FIFO semaphore. Each acquisition returns a release function that is safe to
 * call more than once (subsequent calls are no-ops).
 */
export function createSemaphore(limit: number): Semaphore {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      `createSemaphore: limit must be a positive integer, received ${String(limit)}`,
    );
  }

  const waiters: Waiter[] = [];
  let activeCount = 0;

  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeCount -= 1;
      const next = waiters.shift();
      if (next) {
        activeCount += 1;
        next.resolve(makeRelease());
      }
    };
  };

  const acquire = (): Promise<() => void> => {
    if (activeCount < limit) {
      activeCount += 1;
      return Promise.resolve(makeRelease());
    }
    return new Promise<() => void>((resolve) => {
      waiters.push({ resolve });
    });
  };

  return {
    acquire,
    get active(): number {
      return activeCount;
    },
  };
}
