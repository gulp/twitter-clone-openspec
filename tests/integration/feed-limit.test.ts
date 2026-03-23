/**
 * Integration tests for feed limit parameter handling
 *
 * Tests that cached feed results are sliced to the requested limit.
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

describe("feed limit parameter", () => {
  beforeEach(async () => {
    await cleanupDatabase();
    // Clean up feed cache before each test
    try {
      const keys = await redis.keys("feed:*");
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      // Redis errors are non-fatal in tests
    }
  });

  afterEach(async () => {
    await cleanupDatabase();
    try {
      const keys = await redis.keys("feed:*");
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      // Redis errors are non-fatal in tests
    }
  });

  it("cache miss honors limit parameter", async () => {
    const { user: viewer } = await createTestUser();
    const { user: followed } = await createTestUser();

    // Follow user
    await prisma.follow.create({
      data: {
        followerId: viewer.id,
        followingId: followed.id,
      },
    });

    // Create 10 tweets
    for (let i = 0; i < 10; i++) {
      await createTestTweet(followed.id, {
        content: `Tweet ${i}`,
      });
    }

    const caller = createTestContext(viewer.id);

    // Request with limit=5 (cache miss)
    const result = await caller.feed.home({ limit: 5 });

    expect(result.items.length).toBe(5);
  });

  it("cached result is sliced to requested limit", async () => {
    const { user: viewer } = await createTestUser();
    const { user: followed } = await createTestUser();

    // Follow user
    await prisma.follow.create({
      data: {
        followerId: viewer.id,
        followingId: followed.id,
      },
    });

    // Create 25 tweets (more than default page size)
    for (let i = 0; i < 25; i++) {
      await createTestTweet(followed.id, {
        content: `Tweet ${i}`,
      });
    }

    const caller = createTestContext(viewer.id);

    // First request with limit=20 (cache miss, populates cache)
    const firstResult = await caller.feed.home({ limit: 20 });
    expect(firstResult.items.length).toBe(20);

    // Second request with limit=5 (cache hit, should slice to 5)
    const secondResult = await caller.feed.home({ limit: 5 });
    expect(secondResult.items.length).toBe(5);

    // Verify the items are the same (first 5 from the cached page)
    for (let i = 0; i < 5; i++) {
      expect(secondResult.items[i]?.id).toBe(firstResult.items[i]?.id);
    }
  });

  it("different limits return consistent subset of cached page", async () => {
    const { user: viewer } = await createTestUser();
    const { user: followed } = await createTestUser();

    // Follow user
    await prisma.follow.create({
      data: {
        followerId: viewer.id,
        followingId: followed.id,
      },
    });

    // Create 30 tweets
    for (let i = 0; i < 30; i++) {
      await createTestTweet(followed.id, {
        content: `Tweet ${i}`,
      });
    }

    const caller = createTestContext(viewer.id);

    // Populate cache with limit=25
    const fullResult = await caller.feed.home({ limit: 25 });
    expect(fullResult.items.length).toBe(25);

    // Request with limit=10 (cache hit, slice to 10)
    const smallResult = await caller.feed.home({ limit: 10 });
    expect(smallResult.items.length).toBe(10);

    // Request with limit=15 (cache hit, slice to 15)
    const mediumResult = await caller.feed.home({ limit: 15 });
    expect(mediumResult.items.length).toBe(15);

    // Verify consistency: smallResult items are first 10 of fullResult
    for (let i = 0; i < 10; i++) {
      expect(smallResult.items[i]?.id).toBe(fullResult.items[i]?.id);
    }

    // Verify consistency: mediumResult items are first 15 of fullResult
    for (let i = 0; i < 15; i++) {
      expect(mediumResult.items[i]?.id).toBe(fullResult.items[i]?.id);
    }

    // Verify consistency: smallResult items are first 10 of mediumResult
    for (let i = 0; i < 10; i++) {
      expect(smallResult.items[i]?.id).toBe(mediumResult.items[i]?.id);
    }
  });

  it("limit larger than cached page returns all cached items", async () => {
    const { user: viewer } = await createTestUser();
    const { user: followed } = await createTestUser();

    // Follow user
    await prisma.follow.create({
      data: {
        followerId: viewer.id,
        followingId: followed.id,
      },
    });

    // Create only 8 tweets
    for (let i = 0; i < 8; i++) {
      await createTestTweet(followed.id, {
        content: `Tweet ${i}`,
      });
    }

    const caller = createTestContext(viewer.id);

    // Populate cache with all 8 tweets
    const firstResult = await caller.feed.home({ limit: 20 });
    expect(firstResult.items.length).toBe(8);

    // Request with limit=50 (cache hit, but only 8 items exist)
    const secondResult = await caller.feed.home({ limit: 50 });
    expect(secondResult.items.length).toBe(8);

    // Verify same items returned
    expect(secondResult.items.map((i) => i.id)).toEqual(
      firstResult.items.map((i) => i.id)
    );
  });

  it("cache key remains unchanged regardless of limit", async () => {
    const { user: viewer } = await createTestUser();
    const { user: followed } = await createTestUser();

    // Follow user
    await prisma.follow.create({
      data: {
        followerId: viewer.id,
        followingId: followed.id,
      },
    });

    // Create tweets
    for (let i = 0; i < 15; i++) {
      await createTestTweet(followed.id, {
        content: `Tweet ${i}`,
      });
    }

    const caller = createTestContext(viewer.id);

    // Populate cache with limit=10
    await caller.feed.home({ limit: 10 });

    // Get cache keys before second request
    const keysBefore = await redis.keys("feed:*:page:*");
    const cacheKeyCount = keysBefore.filter((k) => k.includes(":page:")).length;

    // Request with different limit
    await caller.feed.home({ limit: 5 });

    // Get cache keys after second request
    const keysAfter = await redis.keys("feed:*:page:*");
    const cacheKeyCountAfter = keysAfter.filter((k) => k.includes(":page:"))
      .length;

    // Verify no new cache entry was created (same key reused)
    expect(cacheKeyCountAfter).toBe(cacheKeyCount);
  });
});
