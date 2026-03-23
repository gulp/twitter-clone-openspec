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
 * Atomically check connection limit and add connection if under limit.
 * Returns true if connection was added, false if limit reached.
 * Returns false on Redis failure (fail open - allow connection).
 *
 * Addresses race condition described in specs/sse-connection-management.md Gotcha #3.
 */
export async function sseAtomicAddConnection(
  userId: string,
  connectionId: string,
  requestId?: string
): Promise<boolean> {
  try {
    const key = `sse:connections:${userId}`;
    // Atomic check-and-add: SCARD → check limit → SADD + EXPIRE
    // Returns 1 if added, 0 if limit reached
    const luaScript = `
      local key = KEYS[1]
      local member = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])

      local count = redis.call('SCARD', key)
      if count >= limit then
        return 0
      end

      redis.call('SADD', key, member)
      redis.call('EXPIRE', key, ttl)
      return 1
    `;
    const result = await redis.eval(luaScript, 1, key, connectionId, "120", "5");
    return result === 1;
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseAtomicAddConnection",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    // Fail open: allow connection on Redis failure
    return true;
  }
}

/**
 * SSE connection tracking — fail open.
 * Add a connection ID to the set of active SSE connections for a user.
 * No-op on Redis failure.
 */
export async function sseAddConnection(userId: string, connectionId: string, requestId?: string): Promise<void> {
  try {
    const key = `sse:connections:${userId}`;
    // Atomic SADD + EXPIRE to prevent stale keys if process crashes between operations
    const luaScript = `
      local key = KEYS[1]
      local member = ARGV[1]
      local ttl = ARGV[2]
      redis.call('SADD', key, member)
      redis.call('EXPIRE', key, ttl)
      return 1
    `;
    await redis.eval(luaScript, 1, key, connectionId, "120");
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
 * SSE connection tracking — fail open.
 * Refresh TTL on the connection set (called from heartbeat).
 */
export async function sseRefreshConnectionTTL(userId: string, requestId?: string): Promise<void> {
  try {
    await redis.expire(`sse:connections:${userId}`, 120);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "sse",
      operation: "sseRefreshConnectionTTL",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
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
 * TTL: 5 minutes to prevent stale counts from persisting indefinitely.
 */
export async function setUnreadCount(userId: string, count: number, requestId?: string): Promise<void> {
  try {
    await redis.setex(`notification:unread:${userId}`, 300, count.toString());
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
 * Sets 5-minute TTL atomically to prevent stale keys.
 */
export async function incrUnreadCount(userId: string, requestId?: string): Promise<void> {
  try {
    // Atomic INCR + EXPIRE to prevent stale keys
    const lua = `
      local key = KEYS[1]
      local val = redis.call('INCR', key)
      redis.call('EXPIRE', key, 300)
      return val
    `;
    await redis.eval(lua, 1, `notification:unread:${userId}`);
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
 * Sets 5-minute TTL atomically to prevent stale keys.
 */
export async function decrUnreadCount(userId: string, requestId?: string): Promise<void> {
  try {
    // Use Lua to floor at 0 — DECR alone can go negative if count is already 0
    // Also atomically refresh TTL to prevent stale keys
    const lua = `
      local key = KEYS[1]
      local val = redis.call('GET', key)
      if val and tonumber(val) > 0 then
        local newVal = redis.call('DECR', key)
        redis.call('EXPIRE', key, 300)
        return newVal
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
 * Unread notification count — fail open.
 * Decrement unread notification count by N.
 * No-op on Redis failure.
 * Uses Lua script to atomically decrement and floor at 0 (prevents negative counts).
 */
export async function decrUnreadCountBy(userId: string, count: number, requestId?: string): Promise<void> {
  if (count <= 0) return;

  try {
    // Use Lua to atomically: GET count, DECRBY count, floor at 0, refresh TTL
    const lua = `
      local key = KEYS[1]
      local amount = tonumber(ARGV[1])
      local val = redis.call('GET', key)

      if val then
        local currentCount = tonumber(val)
        local newCount = math.max(0, currentCount - amount)
        redis.call('SET', key, newCount)
        redis.call('EXPIRE', key, 300)
        return newCount
      end

      return 0
    `;
    await redis.eval(lua, 1, `notification:unread:${userId}`, count.toString());
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "unread",
      operation: "decrUnreadCountBy",
      count,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

