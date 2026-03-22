import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { log } from "@/lib/logger";
import { prisma } from "../db";
import { redis } from "../redis";

/**
 * SSE Publisher Service
 *
 * Publishes real-time events to users via Redis Pub/Sub + replay buffer.
 *
 * Atomicity guarantee (§1.8):
 * - PUBLISH + LPUSH + LTRIM + EXPIRE in single Lua script
 * - Prevents lost events on process crash between PUBLISH and LPUSH
 *
 * Fallback:
 * - In-memory EventEmitter when Redis unavailable (tests only)
 */

/**
 * Event types
 */
export interface SSEEvent {
  type: "new-tweet" | "notification" | "tweet_deleted";
  data: Record<string, unknown>;
}

/**
 * In-memory event emitter for fallback (tests only).
 * Emits events keyed by userId.
 */
class InMemoryPublisher extends EventEmitter {
  publish(userId: string, event: SSEEvent): void {
    this.emit(userId, event);
  }
}

const inMemoryPublisher = new InMemoryPublisher();

/**
 * Load Lua script from file system
 */
let publishLuaScript: string | null = null;

function loadPublishScript(): string {
  if (publishLuaScript !== null) {
    return publishLuaScript;
  }

  const scriptPath = path.join(process.cwd(), "scripts", "sse-lua", "publish.lua");

  try {
    publishLuaScript = fs.readFileSync(scriptPath, "utf-8");
    return publishLuaScript;
  } catch (error) {
    log.error("Failed to load SSE publish Lua script", {
      scriptPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Failed to load SSE publish Lua script: ${scriptPath}`);
  }
}

/**
 * publishToUser — Publish an event to a single user's SSE stream
 *
 * Uses atomic Lua script to:
 * 1. PUBLISH to sse:user:{userId} channel
 * 2. INCR sse:seq:{userId}
 * 3. LPUSH to sse:replay:{userId}
 * 4. LTRIM sse:replay:{userId} 0 199
 * 5. EXPIRE sse:replay:{userId} 300
 *
 * Fallback to in-memory EventEmitter if Redis unavailable (tests).
 *
 * @returns Sequence number or null if Redis unavailable
 */
export async function publishToUser(userId: string, event: SSEEvent): Promise<number | null> {
  const channel = `sse:user:${userId}`;
  const seqKey = `sse:seq:${userId}`;
  const replayKey = `sse:replay:${userId}`;
  const eventJson = JSON.stringify(event);

  try {
    // Load Lua script
    const script = loadPublishScript();

    // Execute atomic Lua script
    const seq = (await redis.eval(script, 3, channel, seqKey, replayKey, eventJson)) as number;

    log.info("SSE event published", {
      userId,
      eventType: event.type,
      seq,
    });

    return seq;
  } catch (error) {
    log.warn("SSE publishToUser failed, falling back to in-memory", {
      userId,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback to in-memory EventEmitter (tests only)
    inMemoryPublisher.publish(userId, event);
    return null;
  }
}

/**
 * publishToFollowers — Publish an event to all followers of a user
 *
 * Queries the database for follower IDs and calls publishToUser for each.
 * Publishes in parallel with Promise.allSettled (best-effort).
 *
 * @returns Count of successful publishes
 */
export async function publishToFollowers(
  authorId: string,
  event: SSEEvent
): Promise<{ total: number; succeeded: number }> {
  try {
    // Get all follower IDs from database
    const followers = await prisma.follow.findMany({
      where: { followingId: authorId },
      select: { followerId: true },
    });

    const followerIds = followers.map((f) => f.followerId);

    if (followerIds.length === 0) {
      return { total: 0, succeeded: 0 };
    }

    // Publish to all followers in parallel (best-effort)
    const results = await Promise.allSettled(
      followerIds.map((followerId) => publishToUser(followerId, event))
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    log.info("SSE event published to followers", {
      authorId,
      eventType: event.type,
      total: followerIds.length,
      succeeded,
    });

    return { total: followerIds.length, succeeded };
  } catch (error) {
    log.error("publishToFollowers failed", {
      authorId,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    });

    return { total: 0, succeeded: 0 };
  }
}

/**
 * publishNewTweet — Publish new-tweet event to all followers
 *
 * Called when a user creates a tweet.
 * Publishes to all followers so they can update their home feed in real-time.
 */
export async function publishNewTweet(
  authorId: string,
  tweetId: string,
  username: string
): Promise<void> {
  const event: SSEEvent = {
    type: "new-tweet",
    data: {
      tweetId,
      authorUsername: username,
    },
  };

  await publishToFollowers(authorId, event);
}

/**
 * publishNotification — Publish notification event to a single user
 *
 * Called when a notification is created.
 * Publishes to the recipient so they can update their notification bell in real-time.
 */
export async function publishNotification(
  recipientId: string,
  notification: {
    id: string;
    type: string;
    actorId: string;
    tweetId?: string | null;
    createdAt: Date;
  }
): Promise<void> {
  const event: SSEEvent = {
    type: "notification",
    data: {
      notification: {
        ...notification,
        createdAt: notification.createdAt.toISOString(),
      },
    },
  };

  await publishToUser(recipientId, event);
}

/**
 * publishTweetDeleted — Publish tweet_deleted event to all followers
 *
 * Called when a user deletes a tweet.
 * Publishes to all followers so they can remove it from their feed in real-time.
 */
export async function publishTweetDeleted(authorId: string, tweetId: string): Promise<void> {
  const event: SSEEvent = {
    type: "tweet_deleted",
    data: {
      tweetId,
    },
  };

  await publishToFollowers(authorId, event);
}

/**
 * Export in-memory publisher for testing
 */
export { inMemoryPublisher };
