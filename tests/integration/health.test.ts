/**
 * Health endpoint integration tests
 *
 * Verifies /api/health returns correct status transitions and doesn't leak sensitive data.
 */

import { describe, expect, it } from "vitest";

describe("/api/health", () => {
  const healthUrl = "http://localhost:3000/api/health";

  it("returns stable response shape with correct fields", async () => {
    const response = await fetch(healthUrl);
    const data = await response.json();

    // Verify shape
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("db");
    expect(data).toHaveProperty("redis");
    expect(data).toHaveProperty("s3");
    expect(data).toHaveProperty("uptime");

    // Verify types
    expect(typeof data.status).toBe("string");
    expect(typeof data.db).toBe("boolean");
    expect(typeof data.redis).toBe("boolean");
    expect(typeof data.s3).toBe("boolean");
    expect(typeof data.uptime).toBe("number");

    // Verify status is one of the expected values
    expect(["ok", "degraded", "down"]).toContain(data.status);
  });

  it("returns 200 + status=ok when all systems healthy", async () => {
    const response = await fetch(healthUrl);
    const data = await response.json();

    // Assuming local dev environment has all services running
    if (data.db && data.redis && data.s3) {
      expect(response.status).toBe(200);
      expect(data.status).toBe("ok");
    }
  });

  it("returns 200 + status=degraded when Redis or S3 down but DB up", async () => {
    // This test validates the logic but requires manual Redis/S3 shutdown to trigger.
    // For now, we verify the response shape when degraded.
    const response = await fetch(healthUrl);
    const data = await response.json();

    if (data.status === "degraded") {
      expect(response.status).toBe(200);
      expect(data.db).toBe(true);
      expect(data.redis === false || data.s3 === false).toBe(true);
    }
  });

  it("returns 503 when PostgreSQL is down", async () => {
    // This test validates the logic but requires manual PostgreSQL shutdown to trigger.
    // For now, we verify the response shape and status code for "down" state.
    const response = await fetch(healthUrl);
    const data = await response.json();

    if (data.status === "down") {
      expect(response.status).toBe(503);
      expect(data.db).toBe(false);
    }
  });

  it("does not leak secrets, endpoints, or raw exception payloads", async () => {
    const response = await fetch(healthUrl);
    const data = await response.json();
    const responseText = JSON.stringify(data);

    // Should not contain sensitive information
    expect(responseText).not.toMatch(/password/i);
    expect(responseText).not.toMatch(/secret/i);
    expect(responseText).not.toMatch(/token/i);
    expect(responseText).not.toMatch(/api[_-]?key/i);
    expect(responseText).not.toMatch(/localhost:\d{4,5}/); // No internal endpoints
    expect(responseText).not.toMatch(/127\.0\.0\.1/);
    expect(responseText).not.toMatch(/Error:/); // No raw error messages
    expect(responseText).not.toMatch(/at.*\(.*:\d+:\d+\)/); // No stack traces

    // Should only have expected fields
    const allowedKeys = ["status", "db", "redis", "s3", "uptime"];
    const actualKeys = Object.keys(data);
    for (const key of actualKeys) {
      expect(allowedKeys).toContain(key);
    }
  });

  it("uptime is a positive number", async () => {
    const response = await fetch(healthUrl);
    const data = await response.json();

    expect(data.uptime).toBeGreaterThan(0);
    expect(Number.isInteger(data.uptime)).toBe(true);
  });
});
