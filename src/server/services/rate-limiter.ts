import { log } from "@/lib/logger";
import { redis } from "../redis";

/**
 * Rate limiting service with Redis sliding-window implementation (§1.7).
 *
 * Failure policies:
 * - Auth endpoints: fail closed (reject on Redis failure)
 * - General API / read endpoints: fail open (allow on Redis failure)
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // seconds until next allowed request
}

/**
 * Rate limit configuration presets.
 */
export const RATE_LIMITS = {
  AUTH_IP: { limit: 5, windowSeconds: 60, failClosed: true }, // 5/min per IP
  TWEET_CREATE: { limit: 30, windowSeconds: 3600, failClosed: false }, // 30/hour per user
  GENERAL_API: { limit: 100, windowSeconds: 60, failClosed: false }, // 100/min per user
} as const;

/**
 * Check rate limit using Redis sliding window.
 *
 * Uses atomic Lua script to prevent race conditions where concurrent requests
 * could both pass the count check before either adds their entry.
 *
 * @param scope - Rate limit scope (e.g., "auth:ip", "tweet:create", "api:general")
 * @param identifier - User ID, IP address, or email
 * @param limit - Maximum requests allowed in the window
 * @param windowSeconds - Time window in seconds
 * @param failClosed - If true, reject on Redis failure. If false, allow on Redis failure.
 * @returns RateLimitResult with allowed flag and optional retryAfter
 */
export async function checkRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
  failClosed: boolean
): Promise<RateLimitResult> {
  const key = `rate:${scope}:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

  try {
    // Atomic Lua script: remove expired entries, count, check limit, add entry if allowed, set expiry
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local windowSeconds = tonumber(ARGV[4])
      local member = ARGV[5]

      -- Remove expired entries
      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

      -- Get current count
      local count = redis.call('ZCARD', key)

      if count >= limit then
        -- Rate limit exceeded
        -- Get oldest entry to calculate retryAfter
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local oldestTimestamp = tonumber(oldest[2] or now)
        local retryAfter = math.ceil((oldestTimestamp + windowSeconds * 1000 - now) / 1000)
        return {0, retryAfter > 0 and retryAfter or 1}
      end

      -- Add new entry
      redis.call('ZADD', key, now, member)
      redis.call('EXPIRE', key, windowSeconds)

      return {1, 0}
    `;

    const result = (await redis.eval(
      luaScript,
      1, // number of keys
      key,
      now.toString(),
      windowStart.toString(),
      limit.toString(),
      windowSeconds.toString(),
      member
    )) as [number, number];

    const allowed = result[0] === 1;
    const retryAfter = result[1] > 0 ? result[1] : undefined;

    return { allowed, retryAfter };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (failClosed) {
      // FAIL CLOSED: reject request on Redis failure (security-critical paths)
      log.error("Rate limiter Redis failure (fail closed)", {
        feature: "rate-limit",
        scope,
        identifier,
        error: errorMessage,
      });
      throw new Error("Rate limiting unavailable");
    }

    // FAIL OPEN: allow request on Redis failure (graceful degradation)
    log.warn("Rate limiter Redis failure (fail open)", {
      feature: "rate-limit",
      scope,
      identifier,
      error: errorMessage,
    });
    return { allowed: true };
  }
}

/**
 * Check auth IP rate limit (5/min per IP, fail closed).
 *
 * Used for login, registration, password reset requests.
 * Security-critical: rejects on Redis failure.
 */
export async function checkAuthIPRateLimit(ip: string): Promise<RateLimitResult> {
  const { limit, windowSeconds, failClosed } = RATE_LIMITS.AUTH_IP;
  return checkRateLimit("auth:ip", ip, limit, windowSeconds, failClosed);
}

/**
 * Check tweet creation rate limit (30/hour per user, fail open).
 *
 * Used for tweet, reply, quote tweet creation.
 * Degrades gracefully on Redis failure.
 */
export async function checkTweetCreateRateLimit(userId: string): Promise<RateLimitResult> {
  const { limit, windowSeconds, failClosed } = RATE_LIMITS.TWEET_CREATE;
  return checkRateLimit("tweet:create", userId, limit, windowSeconds, failClosed);
}

/**
 * Check general API rate limit (100/min per user, fail open).
 *
 * Used for general read/write operations.
 * Degrades gracefully on Redis failure.
 */
export async function checkGeneralAPIRateLimit(userId: string): Promise<RateLimitResult> {
  const { limit, windowSeconds, failClosed } = RATE_LIMITS.GENERAL_API;
  return checkRateLimit("api:general", userId, limit, windowSeconds, failClosed);
}
