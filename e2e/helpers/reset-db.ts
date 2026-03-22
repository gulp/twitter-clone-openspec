import { execSync } from "child_process";
import path from "path";

/**
 * Reset and re-seed the database before test runs.
 * Ensures a clean, deterministic state for every suite.
 */
export function resetDatabase() {
  const root = path.resolve(__dirname, "../..");
  execSync("rm -f prisma/dev.db && npx prisma db push --accept-data-loss 2>&1", {
    cwd: root,
    stdio: "pipe",
  });
  execSync("npx tsx prisma/seed.ts 2>&1", {
    cwd: root,
    stdio: "pipe",
  });
}
