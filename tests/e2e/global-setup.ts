import { execSync } from "node:child_process";

/**
 * Global setup for E2E tests
 * Runs before all test suites
 */
async function globalSetup() {
  console.log("🔧 E2E Global Setup: Starting...");

  // Run migrations
  console.log("📦 Running database migrations...");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  });

  // Seed the database with fixture data
  console.log("🌱 Seeding database with fixture data...");
  execSync("npx tsx scripts/seed.ts", {
    stdio: "inherit",
    env: process.env,
  });

  console.log("✅ E2E Global Setup: Complete\n");
}

export default globalSetup;
