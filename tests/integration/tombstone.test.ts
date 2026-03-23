/**
 * Integration tests for tombstone TTL behavior
 *
 * Tests independent expiry of deleted tweet IDs in Redis sorted set.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("feed getTombstones cleans up expired entries", async () => {
    const now = Date.now();

    // Add tombstones: one expired, two valid
    await redis.zadd("tombstones:tweets", now - 5000, "expired-id");
    await redis.zadd("tombstones:tweets", now + 60000, "valid-id-1");
    await redis.zadd("tombstones:tweets", now + 60000, "valid-id-2");

    // Create user and trigger cache creation
    const { user } = await createTestUser();
    const caller = createTestContext(user.id);

    // First call: cache miss (getTombstones not called)
    await caller.feed.home({ limit: 20 });

    // Second call: cache hit (getTombstones called, cleanup happens)
    await caller.feed.home({ limit: 20 });

    // Verify cleanup: only valid tombstones remain
    const after = await redis.zrangebyscore("tombstones:tweets", "-inf", "+inf");
    expect(after.length).toBe(2);
    expect(after).toContain("valid-id-1");
    expect(after).toContain("valid-id-2");
  });
});
