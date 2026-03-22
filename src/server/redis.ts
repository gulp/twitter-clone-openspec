import { env } from "@/env";
import { log } from "@/lib/logger";
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
export async function cacheGet(key: string, requestId?: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "cache",
      operation: "GET",
      key,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}

/**
 * Cache SET wrapper — fail open.
 * No-op on Redis failure (cache write is best-effort).
 */
export async function cacheSet(key: string, value: string, ttlSeconds?: number, requestId?: string): Promise<void> {
  try {
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, value);
    } else {
      await redis.set(key, value);
    }
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "cache",
      operation: "SET",
      key,
      ttlSeconds,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * Cache DEL wrapper — fail open.
 * No-op on Redis failure (cache invalidation is best-effort).
 */
export async function cacheDel(key: string, requestId?: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "cache",
      operation: "DEL",
      key,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * Increment wrapper — fail open.
 * Returns null on Redis failure (caller should fall back to DB query).
 */
export async function cacheIncr(key: string, requestId?: string): Promise<number | null> {
  try {
    return await redis.incr(key);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "cache",
      operation: "INCR",
      key,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}

/**
 * Auth rate limiting wrapper — fail closed.
 * RETHROWS on Redis failure — allowing auth requests without rate limiting
 * turns a Redis outage into an account-abuse incident.
 *
 * Uses atomic Lua script to prevent race condition where concurrent requests
 * could both pass the count check before either adds their entry.
 */
export async function authRateLimitCheck(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
  requestId?: string
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `rate:${scope}:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

  try {
    // Atomic Lua script: remove expired, count, check limit, add entry, set expiry
    const luaScript = `
      local key = KEYS[1]
      local now = ARGV[1]
      local windowStart = ARGV[2]
      local limit = ARGV[3]
      local windowSeconds = ARGV[4]
      local member = ARGV[5]

      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
      local count = redis.call('ZCARD', key)

      if count >= tonumber(limit) then
        return {0, 0}
      end

      redis.call('ZADD', key, now, member)
      redis.call('EXPIRE', key, windowSeconds)

      return {1, tonumber(limit) - count - 1}
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

    return {
      allowed: result[0] === 1,
      remaining: result[1],
    };
  } catch (error) {
    // FAIL CLOSED: reject request on Redis failure
    log.error("Redis operation failed", {
      feature: "rate-limit",
      operation: "authRateLimitCheck",
      scope,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    throw new Error("Rate limiting unavailable");
  }
}

/**
 * Session allow-list wrapper — fail open with DB fallback.
 * Returns null on Redis failure (caller falls back to JWT signature + sessionVersion DB check).
 */
export async function sessionGet(jti: string, requestId?: string): Promise<string | null> {
  try {
    return await redis.get(`session:jti:${jti}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "auth",
      operation: "sessionGet",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}

/**
 * Session SET wrapper — fail open.
 * No-op on Redis failure (session allow-list is best-effort performance optimization).
 */
export async function sessionSet(jti: string, data: string, ttlSeconds: number, requestId?: string): Promise<void> {
  try {
    await redis.setex(`session:jti:${jti}`, ttlSeconds, data);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "auth",
      operation: "sessionSet",
      ttlSeconds,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * Session DEL wrapper — fail open.
 * No-op on Redis failure (session invalidation falls back to sessionVersion check).
 */
export async function sessionDel(jti: string, requestId?: string): Promise<void> {
  try {
    await redis.del(`session:jti:${jti}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "auth",
      operation: "sessionDel",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * SSE connection tracking — fail open.
 * Add a connection ID to the set of active SSE connections for a user.
 * No-op on Redis failure.
 */
export async function sseAddConnection(userId: string, connectionId: string, requestId?: string): Promise<void> {
  try {
    await redis.sadd(`sse:connections:${userId}`, connectionId);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseAddConnection",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * SSE connection tracking — fail open.
 * Remove a connection ID from the set of active SSE connections.
 * No-op on Redis failure.
 */
export async function sseRemoveConnection(userId: string, connectionId: string, requestId?: string): Promise<void> {
  try {
    await redis.srem(`sse:connections:${userId}`, connectionId);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseRemoveConnection",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * SSE connection tracking — fail open.
 * Get all active SSE connection IDs for a user.
 * Returns empty array on Redis failure.
 */
export async function sseGetConnections(userId: string, requestId?: string): Promise<string[]> {
  try {
    return await redis.smembers(`sse:connections:${userId}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseGetConnections",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return [];
  }
}

/**
 * Unread notification count — fail open.
 * Get unread notification count from Redis cache.
 * Returns null on Redis failure (caller should fall back to DB COUNT(*)).
 */
export async function getUnreadCount(userId: string, requestId?: string): Promise<number | null> {
  try {
    const count = await redis.get(`notification:unread:${userId}`);
    return count ? Number.parseInt(count, 10) : null;
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "unread",
      operation: "getUnreadCount",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}

/**
 * Unread notification count — fail open.
 * Set unread notification count in Redis cache.
 * No-op on Redis failure.
 */
export async function setUnreadCount(userId: string, count: number, requestId?: string): Promise<void> {
  try {
    await redis.set(`notification:unread:${userId}`, count.toString());
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "unread",
      operation: "setUnreadCount",
      count,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * Unread notification count — fail open.
 * Increment unread notification count.
 * No-op on Redis failure.
 */
export async function incrUnreadCount(userId: string, requestId?: string): Promise<void> {
  try {
    await redis.incr(`notification:unread:${userId}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "unread",
      operation: "incrUnreadCount",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * Unread notification count — fail open.
 * Decrement unread notification count.
 * No-op on Redis failure.
 */
export async function decrUnreadCount(userId: string, requestId?: string): Promise<void> {
  try {
    // Use Lua to floor at 0 — DECR alone can go negative if count is already 0
    const lua = `
      local key = KEYS[1]
      local val = redis.call('GET', key)
      if val and tonumber(val) > 0 then
        return redis.call('DECR', key)
      end
      return 0
    `;
    await redis.eval(lua, 1, `notification:unread:${userId}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "unread",
      operation: "decrUnreadCount",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * SSE sequence number — fail open.
 * Get next monotonic sequence number for user's SSE stream.
 * Returns null on Redis failure (caller should generate local sequence).
 */
export async function sseNextSeq(userId: string, requestId?: string): Promise<number | null> {
  try {
    return await redis.incr(`sse:seq:${userId}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseNextSeq",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}

/**
 * SSE replay buffer — fail open.
 * Add event to replay buffer with TTL and size limit.
 * Buffer is capped at 200 entries via LTRIM.
 * No-op on Redis failure.
 */
export async function sseAddToReplay(userId: string, eventData: string, requestId?: string): Promise<void> {
  try {
    const key = `sse:replay:${userId}`;
    await redis.lpush(key, eventData);
    await redis.ltrim(key, 0, 199); // Keep max 200 entries
    await redis.expire(key, 300); // 5-minute TTL
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseAddToReplay",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * SSE replay buffer — fail open.
 * Get events from replay buffer since a given sequence number.
 * Returns empty array on Redis failure.
 */
export async function sseGetReplay(userId: string, sinceSeq: number, requestId?: string): Promise<string[]> {
  try {
    const key = `sse:replay:${userId}`;
    const events = await redis.lrange(key, 0, -1);

    // Filter events with seq > sinceSeq
    // Events are stored as serialized JSON with id field
    return events.filter((event) => {
      try {
        const parsed = JSON.parse(event);
        return parsed.id > sinceSeq;
      } catch {
        return false;
      }
    });
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseGetReplay",
      sinceSeq,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return [];
  }
}
