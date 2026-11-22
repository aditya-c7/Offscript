import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // The suite boots a Next dev server and waits for a real scan to drain.
    testTimeout: 180_000,
    hookTimeout: 240_000,
    // Fixed loopback processes are started per file; never run files in parallel.
    fileParallelism: false,
    pool: "forks",
  },
});
