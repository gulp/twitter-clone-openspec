import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import { Prisma } from "@prisma/client";
import { prisma, publicUserSelect } from "../db";
import { cacheGet, cacheIncr, cacheSet, redis } from "../redis";

/**
 * Feed service
 *
 * Implements fan-out-on-read feed assembly with Redis caching, versioning,
 * tombstone filtering, and stale-while-revalidate SETNX lock.
 */

/**
 * FeedCursor — opaque cursor for home timeline pagination
 *
 * Contains { effectiveAt, tweetId } because home feed ordering is by
 * effectiveAt (retweet createdAt OR original tweet createdAt) not raw tweet.createdAt.
 */
export interface FeedCursor {
  effectiveAt: Date;
  tweetId: string;
}

/**
 * FeedItem — hydrated tweet with author and engagement state
 */
export interface FeedItem {
  id: string;
  content: string;
  authorId: string;
  parentId: string | null;
  quoteTweetId: string | null;
  quotedTweet: {
    id: string;
    content: string;
    mediaUrls: string[];
    author: {
      username: string;
      displayName: string;
      avatarUrl: string;
    };
  } | null;
  mediaUrls: string[];
  createdAt: Date;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  effectiveAt: Date;
  retweetedBy: string | null; // username of retweeter, or null if original tweet
  hasLiked: boolean;
  hasRetweeted: boolean;
  author: {
    id: string;
    username: string;
    displayName: string;
    bio: string;
    avatarUrl: string;
    bannerUrl: string;
    createdAt: Date;
    followerCount: number;
    followingCount: number;
    tweetCount: number;
  };
}

/**
 * FeedResult — paginated feed result
 */
export interface FeedResult {
  items: FeedItem[];
  nextCursor: string | null;
}

/**
 * assembleFeed — Assemble home timeline for a user
 *
 * Implementation strategy (§1.9):
 * 1. Check Redis feed:version:{userId} vs cached version
 * 2. Cache HIT: deserialize, filter against tombstones:tweets set, return
 * 3. Cache MISS: SETNX feed:{userId}:rebuilding (5s lock)
 *    a. Execute UNION query (original tweets + retweets from followed users)
 *    b. DISTINCT ON dedup
 *    c. Hydrate tweet + author with publicUserSelect (batched query)
 *    d. Batch-check hasLiked/hasRetweeted (§1.16 — two IN queries)
 *    e. Cache page: feed:{userId}:v:{version}:page:{cursorHash} (60s TTL)
 *    f. Return { items, nextCursor }
 * 4. Redis unavailable: fall through to PostgreSQL directly
 *
 * @param userId - ID of user requesting their home timeline
 * @param cursor - opaque cursor string (base64 encoded JSON)
 * @param limit - number of items to return (default 20)
 */
export async function assembleFeed(
  userId: string,
  cursor?: string,
  limit = 20,
  requestId?: string
): Promise<FeedResult> {
  // Parse cursor if provided
  const parsedCursor = cursor ? parseFeedCursor(cursor) : null;

  // Try Redis-cached feed
  const cachedResult = await tryGetCachedFeed(userId, parsedCursor, limit, requestId);
  if (cachedResult) {
    log.info("Feed cache hit", {
      userId,
      cacheHit: true,
      requestId,
    });
    return cachedResult;
  }

  // Cache miss or Redis unavailable — fetch from PostgreSQL
  log.info("Feed cache miss", {
    userId,
    cacheHit: false,
    requestId,
  });
  return await fetchFeedFromDB(userId, parsedCursor, limit, requestId);
}

/**
 * tryGetCachedFeed — Attempt to serve feed from Redis cache
 *
 * Returns null on cache miss, version mismatch, or Redis failure.
 * Slices cached results to the requested limit to avoid over-serving.
 */
async function tryGetCachedFeed(
  userId: string,
  parsedCursor: FeedCursor | null,
  limit: number,
  requestId?: string
): Promise<FeedResult | null> {
  try {
    // Get current feed version
    const versionKey = `feed:version:${userId}`;
    const currentVersion = await cacheGet(versionKey, requestId);

    if (!currentVersion) {
      // No version set — cache miss
      return null;
    }

    // Build cache key for this page
    const cursorHash = parsedCursor ? hashCursor(parsedCursor) : "first";
    const cacheKey = `feed:${userId}:v:${currentVersion}:page:${cursorHash}`;

    const cached = await cacheGet(cacheKey, requestId);
    if (!cached) {
      // Cache miss
      return null;
    }

    // Deserialize cached feed
    const cachedFeed = JSON.parse(cached) as FeedResult;

    // Filter against tombstones:tweets set
    const tombstones = await getTombstones(requestId);
    const filtered = cachedFeed.items.filter((item) => !tombstones.has(item.id));

    // Slice to requested limit to avoid over-serving (cache key doesn't include limit)
    const sliced = filtered.slice(0, limit);

    return {
      items: sliced,
      nextCursor: cachedFeed.nextCursor,
    };
  } catch (error) {
    log.warn("Failed to get cached feed (fail open)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}

/**
 * fetchFeedFromDB — Fetch feed from PostgreSQL with SETNX lock and caching
 */
async function fetchFeedFromDB(
  userId: string,
  parsedCursor: FeedCursor | null,
  limit: number,
  requestId?: string
): Promise<FeedResult> {
  // Acquire SETNX lock (best-effort, fail-open)
  const lockKey = `feed:${userId}:rebuilding`;
  let acquiredLock = false;

  try {
    const lockResult = await redis.set(lockKey, "1", "EX", 5, "NX");
    acquiredLock = lockResult === "OK";
  } catch (error) {
    log.warn("Failed to acquire feed rebuild lock (fail open)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }

  // Execute UNION query (§1.9)
  const feedItems = await fetchFeedItemsFromDB(userId, parsedCursor, limit);

  // Hydrate tweet + author data
  const hydratedItems = await hydrateFeedItems(userId, feedItems);

  // Determine nextCursor
  let nextCursor: string | null = null;
  if (hydratedItems.length > limit) {
    hydratedItems.pop(); // Remove the peek item
    const lastItem = hydratedItems[hydratedItems.length - 1];
    if (lastItem) {
      nextCursor = encodeFeedCursor({
        effectiveAt: lastItem.effectiveAt,
        tweetId: lastItem.id,
      });
    }
  }

  const result: FeedResult = {
    items: hydratedItems,
    nextCursor,
  };

  // Cache the result (best-effort, fail-open)
  if (acquiredLock) {
    await cacheFeedPage(userId, parsedCursor, result, requestId);
  }

  return result;
}

/**
 * fetchFeedItemsFromDB — Execute UNION query to get feed items
 *
 * Returns array of { tweetId, effectiveAt, retweeterId }
 */
async function fetchFeedItemsFromDB(
  userId: string,
  parsedCursor: FeedCursor | null,
  limit: number
): Promise<Array<{ tweetId: string; effectiveAt: Date; retweeterId: string | null }>> {
  const cursorWhere = parsedCursor
    ? Prisma.sql`WHERE ("effectiveAt", "tweetId") < (${parsedCursor.effectiveAt}, ${parsedCursor.tweetId})`
    : Prisma.empty;

  const sql = Prisma.sql`
    WITH followed AS (
      SELECT "followingId" FROM "Follow" WHERE "followerId" = ${userId}
    ),
    feed_items AS (
      -- Original tweets by followed users
      SELECT t.id AS "tweetId", t."createdAt" AS "effectiveAt",
             NULL::text AS "retweeterId"
      FROM "Tweet" t
      WHERE t."authorId" IN (SELECT "followingId" FROM followed)
        AND t.deleted = false AND t."parentId" IS NULL
      UNION ALL
      -- Retweets by followed users
      SELECT rt."tweetId", rt."createdAt" AS "effectiveAt",
             rt."userId" AS "retweeterId"
      FROM "Retweet" rt
      WHERE rt."userId" IN (SELECT "followingId" FROM followed)
        AND EXISTS (
          SELECT 1 FROM "Tweet" t
          WHERE t.id = rt."tweetId" AND t.deleted = false
        )
    ),
    deduped AS (
      SELECT DISTINCT ON ("tweetId") *
      FROM feed_items
      ORDER BY "tweetId", "effectiveAt" DESC, "retweeterId" DESC NULLS LAST
    )
    SELECT * FROM deduped
    ${cursorWhere}
    ORDER BY "effectiveAt" DESC, "tweetId" DESC
    LIMIT ${limit + 1};
  `;

  type RawFeedItem = {
    tweetId: string;
    effectiveAt: Date;
    retweeterId: string | null;
  };

  const rows = await prisma.$queryRaw<RawFeedItem[]>(sql);
  return rows;
}

/**
 * hydrateFeedItems — Hydrate tweet + author data and batch-check engagement
 */
async function hydrateFeedItems(
  userId: string,
  feedItems: Array<{ tweetId: string; effectiveAt: Date; retweeterId: string | null }>
): Promise<FeedItem[]> {
  if (feedItems.length === 0) {
    return [];
  }

  const tweetIds = feedItems.map((item) => item.tweetId);

  // Batch-fetch tweets with authors
  const tweets = await prisma.tweet.findMany({
    where: { id: { in: tweetIds } },
    select: {
      id: true,
      content: true,
      authorId: true,
      parentId: true,
      quoteTweetId: true,
      mediaUrls: true,
      createdAt: true,
      likeCount: true,
      retweetCount: true,
      replyCount: true,
      author: { select: publicUserSelect },
      quotedTweet: {
        select: {
          id: true,
          content: true,
          mediaUrls: true,
          deleted: true,
          author: {
            select: {
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });

  // Build tweet lookup map
  const tweetMap = new Map(tweets.map((t) => [t.id, t]));

  // Batch-check hasLiked/hasRetweeted (§1.16)
  const [likedTweetIds, retweetedTweetIds] = await Promise.all([
    prisma.like
      .findMany({
        where: { userId, tweetId: { in: tweetIds } },
        select: { tweetId: true },
      })
      .then((likes) => new Set(likes.map((l) => l.tweetId))),
    prisma.retweet
      .findMany({
        where: { userId, tweetId: { in: tweetIds } },
        select: { tweetId: true },
      })
      .then((retweets) => new Set(retweets.map((r) => r.tweetId))),
  ]);

  // Fetch retweeter usernames for items with retweeterId
  const retweeterIds = feedItems
    .filter((item) => item.retweeterId !== null)
    .map((item) => item.retweeterId) as string[];

  const retweeters =
    retweeterIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: retweeterIds } },
          select: { id: true, username: true },
        })
      : [];

  const retweeterMap = new Map(retweeters.map((r) => [r.id, r.username]));

  // Assemble hydrated feed items in original order
  const hydrated: FeedItem[] = [];

  for (const feedItem of feedItems) {
    const tweet = tweetMap.get(feedItem.tweetId);
    if (!tweet) {
      // Tweet was deleted between query and hydration — skip
      continue;
    }

    // Redact deleted quoted tweets (I5)
    const quotedTweet = tweet.quotedTweet?.deleted
      ? null
      : tweet.quotedTweet
      ? {
          id: tweet.quotedTweet.id,
          content: tweet.quotedTweet.content,
          mediaUrls: tweet.quotedTweet.mediaUrls,
          author: tweet.quotedTweet.author,
        }
      : null;

    hydrated.push({
      id: tweet.id,
      content: tweet.content,
      authorId: tweet.authorId,
      parentId: tweet.parentId,
      quoteTweetId: tweet.quoteTweetId,
      quotedTweet,
      mediaUrls: tweet.mediaUrls,
      createdAt: tweet.createdAt,
      likeCount: tweet.likeCount,
      retweetCount: tweet.retweetCount,
      replyCount: tweet.replyCount,
      effectiveAt: feedItem.effectiveAt,
      retweetedBy: feedItem.retweeterId ? (retweeterMap.get(feedItem.retweeterId) ?? null) : null,
      hasLiked: likedTweetIds.has(tweet.id),
      hasRetweeted: retweetedTweetIds.has(tweet.id),
      author: tweet.author,
    });
  }

  return hydrated;
}

/**
 * cacheFeedPage — Cache a feed page in Redis with version and TTL
 */
async function cacheFeedPage(
  userId: string,
  parsedCursor: FeedCursor | null,
  result: FeedResult,
  requestId?: string
): Promise<void> {
  try {
    // Get current version (or initialize to 1)
    const versionKey = `feed:version:${userId}`;
    let currentVersion = await cacheGet(versionKey, requestId);

    if (!currentVersion) {
      // Initialize version counter
      const newVersion = await cacheIncr(versionKey, requestId);
      currentVersion = newVersion ? newVersion.toString() : "1";
    }

    const cursorHash = parsedCursor ? hashCursor(parsedCursor) : "first";
    const cacheKey = `feed:${userId}:v:${currentVersion}:page:${cursorHash}`;

    await cacheSet(cacheKey, JSON.stringify(result), 60, requestId);
  } catch (error) {
    log.warn("Failed to cache feed page (fail open)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
  }
}

/**
 * getTombstones — Get set of deleted tweet IDs from Redis
 *
 * Filters by expiry timestamp (score > now) and cleans up expired entries.
 */
async function getTombstones(requestId?: string): Promise<Set<string>> {
  try {
    const now = Date.now();

    // Clean up expired tombstones (score <= now)
    await redis.zremrangebyscore("tombstones:tweets", 0, now);

    // Get non-expired tombstones (score > now)
    const tombstones = await redis.zrangebyscore("tombstones:tweets", now + 1, "+inf");

    return new Set(tombstones);
  } catch (error) {
    log.warn("Failed to get tombstones (fail open)", {
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return new Set();
  }
}

/**
 * parseFeedCursor — Decode base64-encoded feed cursor
 */
function parseFeedCursor(cursor: string): FeedCursor {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    return {
      effectiveAt: new Date(parsed.effectiveAt),
      tweetId: parsed.tweetId,
    };
  } catch (error) {
    throw new Error("Invalid cursor");
  }
}

/**
 * encodeFeedCursor — Encode feed cursor to base64
 */
function encodeFeedCursor(cursor: FeedCursor): string {
  const json = JSON.stringify({
    effectiveAt: cursor.effectiveAt.toISOString(),
    tweetId: cursor.tweetId,
  });
  return Buffer.from(json, "utf-8").toString("base64url");
}

/**
 * hashCursor — Create deterministic cache key from cursor
 */
function hashCursor(cursor: FeedCursor): string {
  const json = JSON.stringify({
    effectiveAt: cursor.effectiveAt.toISOString(),
    tweetId: cursor.tweetId,
  });
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

/**
 * bumpFeedVersionForFollowers — Increment feed version for all followers of a user
 *
 * Called when a user posts a new tweet to invalidate follower caches.
 * Uses batched database queries and Redis pipeline to avoid OOM/connection exhaustion.
 */
export async function bumpFeedVersionForFollowers(userId: string): Promise<void> {
  const BATCH_SIZE = 1000; // Fetch followers in batches
  const PIPELINE_CHUNK_SIZE = 100; // Chunk pipeline commands

  try {
    let skip = 0;

    // Process followers in batches
    while (true) {
      const followers = await prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true },
        take: BATCH_SIZE,
        skip,
      });

      if (followers.length === 0) {
        break;
      }

      const followerIds = followers.map((f) => f.followerId);

      // Use Redis pipeline for bulk INCR, chunked to avoid memory issues
      await bumpVersionsPipeline(followerIds, PIPELINE_CHUNK_SIZE);

      skip += BATCH_SIZE;

      // If we got fewer than BATCH_SIZE, we've reached the end
      if (followers.length < BATCH_SIZE) {
        break;
      }
    }
  } catch (error) {
    log.warn("Failed to bump feed version for followers (fail open)", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * bumpVersionsPipeline — Execute INCR commands in chunked Redis pipeline
 *
 * Splits follower IDs into chunks and executes pipeline for each chunk.
 * Prevents memory exhaustion from 100k+ INCR commands in single pipeline.
 */
async function bumpVersionsPipeline(followerIds: string[], chunkSize: number): Promise<void> {
  try {
    for (let i = 0; i < followerIds.length; i += chunkSize) {
      const chunk = followerIds.slice(i, i + chunkSize);
      const pipeline = redis.pipeline();

      for (const followerId of chunk) {
        pipeline.incr(`feed:version:${followerId}`);
      }

      await pipeline.exec();
    }
  } catch (error) {
    log.warn("Redis pipeline failed in bumpVersionsPipeline (fail open)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
