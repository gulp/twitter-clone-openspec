import { env } from "@/env";
import Redis from "ioredis";

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
export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
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
  windowSeconds: number
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
export async function sessionSet(jti: string, data: string, ttlSeconds: number): Promise<void> {
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

/**
 * SSE connection tracking — fail open.
 * Add a connection ID to the set of active SSE connections for a user.
 * No-op on Redis failure.
 */
export async function sseAddConnection(userId: string, connectionId: string): Promise<void> {
  try {
    await redis.sadd(`sse:connections:${userId}`, connectionId);
  } catch (error) {
    console.warn("[REDIS] sseAddConnection failed (fail open):", {
      userId,
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * SSE connection tracking — fail open.
 * Remove a connection ID from the set of active SSE connections.
 * No-op on Redis failure.
 */
export async function sseRemoveConnection(userId: string, connectionId: string): Promise<void> {
  try {
    await redis.srem(`sse:connections:${userId}`, connectionId);
  } catch (error) {
    console.warn("[REDIS] sseRemoveConnection failed (fail open):", {
      userId,
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * SSE connection tracking — fail open.
 * Get all active SSE connection IDs for a user.
 * Returns empty array on Redis failure.
 */
export async function sseGetConnections(userId: string): Promise<string[]> {
  try {
    return await redis.smembers(`sse:connections:${userId}`);
  } catch (error) {
    console.warn("[REDIS] sseGetConnections failed (fail open):", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Unread notification count — fail open.
 * Get unread notification count from Redis cache.
 * Returns null on Redis failure (caller should fall back to DB COUNT(*)).
 */
export async function getUnreadCount(userId: string): Promise<number | null> {
  try {
    const count = await redis.get(`notification:unread:${userId}`);
    return count ? Number.parseInt(count, 10) : null;
  } catch (error) {
    console.warn("[REDIS] getUnreadCount failed (fail open):", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Unread notification count — fail open.
 * Set unread notification count in Redis cache.
 * No-op on Redis failure.
 */
export async function setUnreadCount(userId: string, count: number): Promise<void> {
  try {
    await redis.set(`notification:unread:${userId}`, count.toString());
  } catch (error) {
    console.warn("[REDIS] setUnreadCount failed (fail open):", {
      userId,
      count,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Unread notification count — fail open.
 * Increment unread notification count.
 * No-op on Redis failure.
 */
export async function incrUnreadCount(userId: string): Promise<void> {
  try {
    await redis.incr(`notification:unread:${userId}`);
  } catch (error) {
    console.warn("[REDIS] incrUnreadCount failed (fail open):", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
