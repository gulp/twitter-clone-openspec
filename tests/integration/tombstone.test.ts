/**
 * Integration tests for tombstone TTL behavior
 *
 * Tests independent expiry of deleted tweet IDs in Redis sorted set.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/server/db";
import { redis } from "@/server/redis";
import {
  cleanupDatabase,
  createTestContext,
  createTestUser,
  createTestTweet,
} from "./helpers";

describe("tombstone TTL", () => {
  beforeEach(async () => {
    await cleanupDatabase();
    // Clean up tombstones sorted set before each test
    try {
      await redis.del("tombstones:tweets");
    } catch (error) {
      // Redis errors are non-fatal in tests
    }
  });

  afterEach(async () => {
    await cleanupDatabase();
    try {
      await redis.del("tombstones:tweets");
    } catch (error) {
      // Redis errors are non-fatal in tests
    }
  });

  it("adds tombstone with independent expiry timestamp on delete", async () => {
    const { user } = await createTestUser();
    const tweet = await createTestTweet(user.id, {
      content: "Test tweet",
    });

    const caller = createTestContext(user.id);

    const beforeDelete = Date.now();
    await caller.tweet.delete({ tweetId: tweet.id });
    const afterDelete = Date.now();

    // Verify tombstone was added to sorted set
    const tombstones = await redis.zrangebyscore(
      "tombstones:tweets",
      "-inf",
      "+inf",
      "WITHSCORES"
    );

    expect(tombstones.length).toBe(2); // [member, score]
    expect(tombstones[0]).toBe(tweet.id);

    // Verify score is expiry timestamp (~60s from now)
    const score = Number.parseFloat(tombstones[1] as string);
    const expectedExpiry = beforeDelete + 60000;
    const tolerance = afterDelete - beforeDelete + 100; // Allow some timing variance

    expect(score).toBeGreaterThanOrEqual(expectedExpiry - tolerance);
    expect(score).toBeLessThanOrEqual(expectedExpiry + tolerance);
  });

  it("tombstones expire independently", async () => {
    const { user } = await createTestUser();
    const tweet1 = await createTestTweet(user.id, {
      content: "Tweet 1",
    });
    const tweet2 = await createTestTweet(user.id, {
      content: "Tweet 2",
    });

    const caller = createTestContext(user.id);

    const now = Date.now();

    // Delete tweet1 with expiry in the past (already expired)
    await redis.zadd("tombstones:tweets", now - 1000, tweet1.id);

    // Delete tweet2 via API (gets normal 60s expiry)
    await caller.tweet.delete({ tweetId: tweet2.id });

    // Get all tombstones (including expired)
    const allTombstones = await redis.zrangebyscore(
      "tombstones:tweets",
      "-inf",
      "+inf"
    );
    expect(allTombstones.length).toBe(2); // Both exist in sorted set

    // Get non-expired tombstones (score > now)
    const validTombstones = await redis.zrangebyscore(
      "tombstones:tweets",
      now + 1,
      "+inf"
    );
    expect(validTombstones.length).toBe(1);
    expect(validTombstones[0]).toBe(tweet2.id);

    // Clean up expired entries
    await redis.zremrangebyscore("tombstones:tweets", 0, now);

    // After cleanup, only tweet2 remains
    const afterCleanup = await redis.zrangebyscore(
      "tombstones:tweets",
      "-inf",
      "+inf"
    );
    expect(afterCleanup.length).toBe(1);
    expect(afterCleanup[0]).toBe(tweet2.id);
  });

  it("recent tombstones survive during quiet periods", async () => {
    const { user } = await createTestUser();
    const tweet = await createTestTweet(user.id, {
      content: "Test tweet",
    });

    const caller = createTestContext(user.id);

    // Delete tweet
    await caller.tweet.delete({ tweetId: tweet.id });

    // Verify tombstone exists immediately
    const beforeWait = await redis.zrangebyscore(
      "tombstones:tweets",
      Date.now() + 1,
      "+inf"
    );
    expect(beforeWait.length).toBe(1);
    expect(beforeWait[0]).toBe(tweet.id);

    // Wait 2 seconds (quiet period, no other deletes)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Tombstone should still exist (not expired yet)
    const afterWait = await redis.zrangebyscore(
      "tombstones:tweets",
      Date.now() + 1,
      "+inf"
    );
    expect(afterWait.length).toBe(1);
    expect(afterWait[0]).toBe(tweet.id);
  });

  it("burst deletes don't keep stale entries alive", async () => {
    const { user } = await createTestUser();
    const tweets = await Promise.all([
      createTestTweet(user.id, { content: "Tweet 1" }),
      createTestTweet(user.id, { content: "Tweet 2" }),
      createTestTweet(user.id, { content: "Tweet 3" }),
    ]);

    const caller = createTestContext(user.id);

    const now = Date.now();

    // Simulate burst: add first tweet with expired timestamp
    await redis.zadd("tombstones:tweets", now - 5000, tweets[0].id);

    // Delete remaining tweets in quick succession
    await caller.tweet.delete({ tweetId: tweets[1].id });
    await caller.tweet.delete({ tweetId: tweets[2].id });

    // All three entries exist in sorted set
    const allTombstones = await redis.zrangebyscore(
      "tombstones:tweets",
      "-inf",
      "+inf"
    );
    expect(allTombstones.length).toBe(3);

    // Only the recent two are non-expired
    const validTombstones = await redis.zrangebyscore(
      "tombstones:tweets",
      now + 1,
      "+inf"
    );
    expect(validTombstones.length).toBe(2);
    expect(validTombstones).toContain(tweets[1].id);
    expect(validTombstones).toContain(tweets[2].id);
    expect(validTombstones).not.toContain(tweets[0].id);

    // The stale entry (tweets[0]) is NOT kept alive by the burst
    // It can be cleaned up independently
    await redis.zremrangebyscore("tombstones:tweets", 0, now);

    const afterCleanup = await redis.zrangebyscore(
      "tombstones:tweets",
      "-inf",
      "+inf"
    );
    expect(afterCleanup.length).toBe(2);
    expect(afterCleanup).not.toContain(tweets[0].id);
  });

  it("feed assembly cleans up expired tombstones and filters correctly", async () => {
    const { user: viewer } = await createTestUser();
    const { user: followed } = await createTestUser();

    // Follow user
    await prisma.follow.create({
      data: {
        followerId: viewer.id,
        followingId: followed.id,
      },
    });

    const tweet1 = await createTestTweet(followed.id, {
      content: "Deleted recently",
    });
    const tweet2 = await createTestTweet(followed.id, {
      content: "Deleted long ago",
    });
    const tweet3 = await createTestTweet(followed.id, {
      content: "Not deleted",
    });

    const caller = createTestContext(viewer.id);

    const now = Date.now();

    // Mark tweet1 as deleted with recent tombstone (valid)
    await prisma.tweet.update({
      where: { id: tweet1.id },
      data: { deleted: true, deletedAt: new Date() },
    });
    await redis.zadd("tombstones:tweets", now + 60000, tweet1.id);

    // Mark tweet2 as deleted with expired tombstone
    await prisma.tweet.update({
      where: { id: tweet2.id },
      data: { deleted: true, deletedAt: new Date() },
    });
    await redis.zadd("tombstones:tweets", now - 1000, tweet2.id);

    // Get feed
    const result = await caller.feed.home({ limit: 20 });

    // Should only include tweet3 (not deleted)
    // tweet1 is filtered by tombstone (recent, valid)
    // tweet2 is filtered by deleted=true in DB query (tombstone expired but soft-delete flag remains)
    expect(result.items.length).toBe(1);
    expect(result.items[0]?.id).toBe(tweet3.id);

    // Verify cleanup happened: expired tombstone removed
    const remainingTombstones = await redis.zrangebyscore(
      "tombstones:tweets",
      "-inf",
      "+inf"
    );
    // Only tweet1's tombstone remains (tweet2's expired tombstone was cleaned)
    expect(remainingTombstones.length).toBe(1);
    expect(remainingTombstones[0]).toBe(tweet1.id);
  });
});
