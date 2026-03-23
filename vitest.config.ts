import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 2,
      },
    },
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 10000,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "tests/perf/**", "node_modules/**"],
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
