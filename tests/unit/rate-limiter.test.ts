import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Rate limiter tests — validates sliding window behavior and Redis failure modes.
 *
 * Per §1.7 and §4 Redis Failure Strategy:
 * - Auth endpoints: fail closed (reject on Redis failure)
 * - Read endpoints: fail open (allow on Redis failure)
 *
 * CRITICAL: This test explicitly verifies both failure modes per bead comment.
 */

describe("Rate limiter", () => {
  let mockRedis: any;

  beforeEach(async () => {
    // Reset modules to allow fresh imports
    vi.resetModules();

    // Import ioredis-mock for Redis simulation
    const { default: RedisMock } = await import("ioredis-mock");
    mockRedis = new RedisMock();

    // Mock the redis module
    vi.doMock("@/server/redis", () => ({
      redis: mockRedis,
    }));
  });

  afterEach(() => {
    vi.doUnmock("@/server/redis");
  });

  describe("under normal operation", () => {
    it("should allow requests under limit", async () => {
      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      const result = await checkRateLimit("test", "user-1", 5, 60, false);

      expect(result.allowed).toBe(true);
      expect(result.retryAfter).toBeUndefined();
    });

    it("should block requests at limit", async () => {
      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      // Make 5 requests (limit)
      for (let i = 0; i < 5; i++) {
        const result = await checkRateLimit("test", "user-1", 5, 60, false);
        expect(result.allowed).toBe(true);
      }

      // 6th request should be blocked
      const result = await checkRateLimit("test", "user-1", 5, 60, false);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should allow requests again after window expiry", async () => {
      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      // Fill up the limit
      for (let i = 0; i < 5; i++) {
        await checkRateLimit("test", "user-1", 5, 1, false); // 1 second window
      }

      // Should be blocked
      const blocked = await checkRateLimit("test", "user-1", 5, 1, false);
      expect(blocked.allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be allowed again
      const allowed = await checkRateLimit("test", "user-1", 5, 1, false);
      expect(allowed.allowed).toBe(true);
    });

    it("should use sliding window behavior", async () => {
      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      // Make 3 requests at T=0
      for (let i = 0; i < 3; i++) {
        await checkRateLimit("test", "user-1", 5, 2, false); // 2 second window
      }

      // Wait 1 second (half the window)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Make 2 more requests (total 5, should succeed)
      const result1 = await checkRateLimit("test", "user-1", 5, 2, false);
      const result2 = await checkRateLimit("test", "user-1", 5, 2, false);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);

      // 6th request should be blocked (sliding window still has 5 requests)
      const result3 = await checkRateLimit("test", "user-1", 5, 2, false);
      expect(result3.allowed).toBe(false);
    });

    it("should isolate rate limits by scope and identifier", async () => {
      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      // Fill limit for user-1 in scope1
      for (let i = 0; i < 5; i++) {
        await checkRateLimit("scope1", "user-1", 5, 60, false);
      }

      // user-2 in scope1 should still be allowed
      const result1 = await checkRateLimit("scope1", "user-2", 5, 60, false);
      expect(result1.allowed).toBe(true);

      // user-1 in scope2 should still be allowed
      const result2 = await checkRateLimit("scope2", "user-1", 5, 60, false);
      expect(result2.allowed).toBe(true);
    });
  });

  describe("Redis failure modes", () => {
    it("should REJECT on Redis failure when failClosed=true (auth path)", async () => {
      // Create a failing Redis mock
      const failingRedis = {
        eval: vi.fn().mockRejectedValue(new Error("Redis connection failed")),
      };

      vi.doMock("@/server/redis", () => ({
        redis: failingRedis,
      }));

      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      // Auth path with failClosed=true should throw
      await expect(
        checkRateLimit("auth:ip", "192.168.1.1", 5, 60, true)
      ).rejects.toThrow("Rate limiting unavailable");

      expect(failingRedis.eval).toHaveBeenCalled();

      vi.doUnmock("@/server/redis");
    });

    it("should ALLOW on Redis failure when failClosed=false (read path)", async () => {
      // Create a failing Redis mock
      const failingRedis = {
        eval: vi.fn().mockRejectedValue(new Error("Redis connection failed")),
      };

      vi.doMock("@/server/redis", () => ({
        redis: failingRedis,
      }));

      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      // Read path with failClosed=false should allow (fail open)
      const result = await checkRateLimit("api:general", "user-1", 100, 60, false);

      expect(result.allowed).toBe(true);
      expect(result.retryAfter).toBeUndefined();
      expect(failingRedis.eval).toHaveBeenCalled();

      vi.doUnmock("@/server/redis");
    });

    it("should verify checkAuthIPRateLimit uses failClosed=true", async () => {
      const { default: RedisMock } = await import("ioredis-mock");
      const workingRedis = new RedisMock();

      vi.doMock("@/server/redis", () => ({
        redis: workingRedis,
      }));

      const { checkAuthIPRateLimit, RATE_LIMITS } = await import(
        "@/server/services/rate-limiter"
      );

      // Verify RATE_LIMITS.AUTH_IP has failClosed=true
      expect(RATE_LIMITS.AUTH_IP.failClosed).toBe(true);

      // Verify checkAuthIPRateLimit works under normal conditions
      const result = await checkAuthIPRateLimit("192.168.1.1");
      expect(result.allowed).toBe(true);

      vi.doUnmock("@/server/redis");
    });

    it("should verify checkTweetCreateRateLimit uses failClosed=false", async () => {
      const { default: RedisMock } = await import("ioredis-mock");
      const workingRedis = new RedisMock();

      vi.doMock("@/server/redis", () => ({
        redis: workingRedis,
      }));

      const { checkTweetCreateRateLimit, RATE_LIMITS } = await import(
        "@/server/services/rate-limiter"
      );

      // Verify RATE_LIMITS.TWEET_CREATE has failClosed=false
      expect(RATE_LIMITS.TWEET_CREATE.failClosed).toBe(false);

      // Verify checkTweetCreateRateLimit works under normal conditions
      const result = await checkTweetCreateRateLimit("user-1");
      expect(result.allowed).toBe(true);

      vi.doUnmock("@/server/redis");
    });

    it("should verify checkGeneralAPIRateLimit uses failClosed=false", async () => {
      const { default: RedisMock } = await import("ioredis-mock");
      const workingRedis = new RedisMock();

      vi.doMock("@/server/redis", () => ({
        redis: workingRedis,
      }));

      const { checkGeneralAPIRateLimit, RATE_LIMITS } = await import(
        "@/server/services/rate-limiter"
      );

      // Verify RATE_LIMITS.GENERAL_API has failClosed=false
      expect(RATE_LIMITS.GENERAL_API.failClosed).toBe(false);

      // Verify checkGeneralAPIRateLimit works under normal conditions
      const result = await checkGeneralAPIRateLimit("user-1");
      expect(result.allowed).toBe(true);

      vi.doUnmock("@/server/redis");
    });
  });

  describe("retryAfter calculation", () => {
    it("should provide retryAfter when rate limit exceeded", async () => {
      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      // Fill up the limit
      for (let i = 0; i < 5; i++) {
        await checkRateLimit("test", "user-1", 5, 60, false);
      }

      // Next request should be blocked with retryAfter
      const result = await checkRateLimit("test", "user-1", 5, 60, false);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    });
  });
});
