import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The fixture servers bind fixed ports (4101-4106), so test files must
    // never run concurrently.
    fileParallelism: false,
    pool: "forks",
  },
});
