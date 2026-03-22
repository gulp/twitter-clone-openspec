import Redis from "ioredis";
import { env } from "@/env";

/**
 * Redis client singleton.
 */
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

/**
 * Redis failure policy (§4):
 * - Auth rate limiting: RETHROW errors (fail closed) — reject request on Redis failure
 * - Cache, SSE, unread counts: return null/no-op (fail open) — degrade gracefully
 */

/**
 * Cache GET wrapper — fail open.
 * Returns null on Redis failure (falls through to PostgreSQL query).
 */
export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (error) {
    console.warn("[REDIS] cacheGet failed (fail open):", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Cache SET wrapper — fail open.
 * No-op on Redis failure (cache write is best-effort).
 */
export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  try {
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, value);
    } else {
      await redis.set(key, value);
    }
  } catch (error) {
    console.warn("[REDIS] cacheSet failed (fail open):", {
      key,
      ttlSeconds,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cache DEL wrapper — fail open.
 * No-op on Redis failure (cache invalidation is best-effort).
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    console.warn("[REDIS] cacheDel failed (fail open):", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Increment wrapper — fail open.
 * Returns null on Redis failure (caller should fall back to DB query).
 */
export async function cacheIncr(key: string): Promise<number | null> {
  try {
    return await redis.incr(key);
  } catch (error) {
    console.warn("[REDIS] cacheIncr failed (fail open):", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Auth rate limiting wrapper — fail closed.
 * RETHROWS on Redis failure — allowing auth requests without rate limiting
 * turns a Redis outage into an account-abuse incident.
 */
export async function authRateLimitCheck(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `rate:${scope}:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  try {
    // Remove expired entries
    await redis.zremrangebyscore(key, 0, windowStart);

    // Count requests in current window
    const count = await redis.zcard(key);

    if (count >= limit) {
      return { allowed: false, remaining: 0 };
    }

    // Add current request
    await redis.zadd(key, now, `${now}`);
    await redis.expire(key, windowSeconds);

    return { allowed: true, remaining: limit - count - 1 };
  } catch (error) {
    // FAIL CLOSED: reject request on Redis failure
    console.error("[REDIS] authRateLimitCheck failed (fail closed):", {
      scope,
      identifier,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Rate limiting unavailable");
  }
}

/**
 * Session allow-list wrapper — fail open with DB fallback.
 * Returns null on Redis failure (caller falls back to JWT signature + sessionVersion DB check).
 */
export async function sessionGet(jti: string): Promise<string | null> {
  try {
    return await redis.get(`session:jti:${jti}`);
  } catch (error) {
    console.warn("[REDIS] sessionGet failed (fail open, DB fallback):", {
      jti,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Session SET wrapper — fail open.
 * No-op on Redis failure (session allow-list is best-effort performance optimization).
 */
export async function sessionSet(
  jti: string,
  data: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redis.setex(`session:jti:${jti}`, ttlSeconds, data);
  } catch (error) {
    console.warn("[REDIS] sessionSet failed (fail open):", {
      jti,
      ttlSeconds,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Session DEL wrapper — fail open.
 * No-op on Redis failure (session invalidation falls back to sessionVersion check).
 */
export async function sessionDel(jti: string): Promise<void> {
  try {
    await redis.del(`session:jti:${jti}`);
  } catch (error) {
    console.warn("[REDIS] sessionDel failed (fail open):", {
      jti,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
