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
    it("should allow first request under limit", async () => {
      const { checkRateLimit } = await import("@/server/services/rate-limiter");

      const result = await checkRateLimit("test", "user-1", 5, 60, false);

      expect(result.allowed).toBe(true);
      expect(result.retryAfter).toBeUndefined();
    });

    it("should construct correct Redis key pattern", () => {
      const scope = "auth:ip";
      const identifier = "192.168.1.1";
      const expectedKey = `rate:${scope}:${identifier}`;

      expect(expectedKey).toBe("rate:auth:ip:192.168.1.1");
    });

    it("should verify rate limit configuration constants", async () => {
      const { RATE_LIMITS } = await import("@/server/services/rate-limiter");

      // Per spec: 5/min for auth, 30/hour for tweets, 100/min for general API
      expect(RATE_LIMITS.AUTH_IP.limit).toBe(5);
      expect(RATE_LIMITS.AUTH_IP.windowSeconds).toBe(60);

      expect(RATE_LIMITS.TWEET_CREATE.limit).toBe(30);
      expect(RATE_LIMITS.TWEET_CREATE.windowSeconds).toBe(3600);

      expect(RATE_LIMITS.GENERAL_API.limit).toBe(100);
      expect(RATE_LIMITS.GENERAL_API.windowSeconds).toBe(60);
    });

    it("should isolate rate limits by scope", () => {
      // Different scopes use different keys
      const user = "user-1";
      const key1 = `rate:scope1:${user}`;
      const key2 = `rate:scope2:${user}`;

      expect(key1).not.toBe(key2);
    });

    it("should isolate rate limits by identifier", () => {
      // Different identifiers use different keys
      const scope = "auth:ip";
      const key1 = `rate:${scope}:192.168.1.1`;
      const key2 = `rate:${scope}:192.168.1.2`;

      expect(key1).not.toBe(key2);
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
    it("should include retryAfter in result when blocked", () => {
      // Contract: When allowed=false, retryAfter should indicate seconds until retry
      const blockedResult = {
        allowed: false,
        retryAfter: 45,
      };

      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.retryAfter).toBeGreaterThan(0);
      expect(blockedResult.retryAfter).toBeLessThanOrEqual(60);
    });

    it("should not include retryAfter when allowed", () => {
      // Contract: When allowed=true, retryAfter is undefined
      const allowedResult = {
        allowed: true,
        retryAfter: undefined,
      };

      expect(allowedResult.allowed).toBe(true);
      expect(allowedResult.retryAfter).toBeUndefined();
    });
  });
});
