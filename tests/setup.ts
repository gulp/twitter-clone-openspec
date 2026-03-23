/**
 * Vitest global setup — loads .env.test before any test runs.
 *
 * This ensures integration tests connect to the test database (port 5433),
 * test Redis (port 6380), and test MinIO (port 9002) instead of the
 * development instances.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath: string) {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Only set if not already defined (don't override explicit env vars)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.test may not exist in all environments
  }
}

// Load .env.test, then fall back to .env for any missing vars
loadEnvFile(resolve(__dirname, "../.env.test"));
loadEnvFile(resolve(__dirname, "../.env"));
