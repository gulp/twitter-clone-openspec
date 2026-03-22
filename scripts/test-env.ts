#!/usr/bin/env tsx

/**
 * Manual test script to verify env.ts validation behavior.
 * Run with: npx tsx scripts/test-env.ts
 *
 * This tests the process.exit() behavior when required env vars are missing.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

console.log("Testing env.ts validation...\n");

// Test 1: Missing DATABASE_URL should crash with clear message
console.log("Test 1: Missing DATABASE_URL");
console.log("Expected: Process should exit with error message");

const testProcess = spawn("node", ["--loader", "ts-node/esm", "-e", 'import("../src/env.js")'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DATABASE_URL: undefined,
    REDIS_URL: "redis://localhost:6379",
    NEXTAUTH_URL: "http://localhost:3000",
    NEXTAUTH_SECRET: "a".repeat(32),
    S3_ENDPOINT: "http://localhost:9000",
    S3_REGION: "us-east-1",
    S3_BUCKET: "test",
    S3_ACCESS_KEY: "test",
    S3_SECRET_KEY: "test",
    S3_PUBLIC_URL: "http://localhost:9000/test",
    APP_ORIGIN: "http://localhost:3000",
  },
  stdio: "pipe",
});

let output = "";
testProcess.stderr.on("data", (data) => {
  output += data.toString();
});

testProcess.on("close", (code) => {
  if (code !== 0) {
    console.log("✓ Process exited with code", code);
    if (output.includes("Environment validation failed") && output.includes("DATABASE_URL")) {
      console.log("✓ Error message mentions DATABASE_URL");
    } else {
      console.log("✗ Error message missing expected content");
      console.log("Output:", output);
    }
  } else {
    console.log("✗ Process should have exited with error code");
  }
  console.log("\nManual verification complete.");
  console.log("To test with all env vars set, run: DATABASE_URL=test npm run dev");
});
