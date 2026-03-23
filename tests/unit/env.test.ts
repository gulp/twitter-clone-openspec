import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Environment validation tests.
 *
 * Note: These tests verify the Zod schema behavior, but cannot test
 * the actual process.exit() behavior without spawning child processes.
 * The exit behavior is manually verified via scripts/test-env.ts
 */

describe("env.ts validation schema", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to allow re-import with different env vars
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it("should accept all required env vars", async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
      NEXTAUTH_URL: "http://localhost:3000",
      NEXTAUTH_SECRET: "a".repeat(32),
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "test-bucket",
      S3_ACCESS_KEY: "minioadmin",
      S3_SECRET_KEY: "minioadmin",
      S3_PUBLIC_URL: "http://localhost:9000/test-bucket",
      APP_ORIGIN: "http://localhost:3000",
      NODE_ENV: "test",
    };

    const { env } = await import("../../src/env.js");
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.S3_BUCKET).toBe("test-bucket");
  });

  it("should accept optional env vars", async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
      NEXTAUTH_URL: "http://localhost:3000",
      NEXTAUTH_SECRET: "a".repeat(32),
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "test-bucket",
      S3_ACCESS_KEY: "minioadmin",
      S3_SECRET_KEY: "minioadmin",
      S3_PUBLIC_URL: "http://localhost:9000/test-bucket",
      APP_ORIGIN: "http://localhost:3000",
      NODE_ENV: "test",
      // Optional vars
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      SMTP_HOST: "smtp.example.com",
    };

    const { env } = await import("../../src/env.js");
    expect(env.GOOGLE_CLIENT_ID).toBe("google-client-id");
    expect(env.SMTP_HOST).toBe("smtp.example.com");
  });

  it("should handle missing optional vars without crashing", async () => {
    // Build a clean env with only required vars (no optional vars from .env.test)
    process.env = {
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
      NEXTAUTH_URL: "http://localhost:3000",
      NEXTAUTH_SECRET: "a".repeat(32),
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "test-bucket",
      S3_ACCESS_KEY: "minioadmin",
      S3_SECRET_KEY: "minioadmin",
      S3_PUBLIC_URL: "http://localhost:9000/test-bucket",
      APP_ORIGIN: "http://localhost:3000",
      NODE_ENV: "test",
    };

    const { env } = await import("../../src/env.js");
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
  });
});
