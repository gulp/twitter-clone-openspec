/**
 * Integration tests for feed router
 *
 * Tests home timeline with deduplication, pagination, and filtering.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/server/db";
import {
  cleanupDatabase,
  createTestContext,
  createTestUser,
  createTestTweet,
} from "./helpers";

describe("feed router", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("getHomeTimeline", () => {
    it("returns followed users' tweets only", async () => {
      const { user: viewer } = await createTestUser();
      const { user: followed } = await createTestUser();
      const { user: notFollowed } = await createTestUser();

      // Follow one user
      await prisma.follow.create({
        data: {
          followerId: viewer.id,
          followingId: followed.id,
        },
      });

      // Create tweets from both users
      const followedTweet = await createTestTweet(followed.id, {
        content: "Followed user tweet",
      });
      await createTestTweet(notFollowed.id, {
        content: "Not followed user tweet",
      });

      const caller = createTestContext(viewer.id);

      const result = await caller.feed.home({ limit: 20 });

      // Should only include followed user's tweet
      expect(result.items.length).toBe(1);
      expect(result.items[0]!.id).toBe(followedTweet.id);
    });

    it("deduplicates original tweet and retweet", async () => {
      const { user: viewer } = await createTestUser();
      const { user: author } = await createTestUser();
      const { user: retweeter } = await createTestUser();

      // Follow both author and retweeter
      await prisma.follow.createMany({
        data: [
          { followerId: viewer.id, followingId: author.id },
          { followerId: viewer.id, followingId: retweeter.id },
        ],
      });

      // Create tweet
      const tweet = await createTestTweet(author.id, {
        content: "Original tweet",
      });

      // Create retweet
      await prisma.retweet.create({
        data: {
          userId: retweeter.id,
          tweetId: tweet.id,
        },
      });

      const caller = createTestContext(viewer.id);

      const result = await caller.feed.home({ limit: 20 });

      // Should deduplicate: only one entry for the original tweet
      // (may include retweet metadata but not duplicate the tweet itself)
      const tweetIds = result.items.map((item) => item.id);
      const uniqueTweetIds = new Set(tweetIds);

      expect(uniqueTweetIds.size).toBe(tweetIds.length);
    });

    it("supports cursor pagination", async () => {
      const { user: viewer } = await createTestUser();
      const { user: followed } = await createTestUser();

      // Follow user
      await prisma.follow.create({
        data: {
          followerId: viewer.id,
          followingId: followed.id,
        },
      });

      // Create 3 tweets
      await createTestTweet(followed.id, { content: "Tweet 1" });
      await createTestTweet(followed.id, { content: "Tweet 2" });
      await createTestTweet(followed.id, { content: "Tweet 3" });

      const caller = createTestContext(viewer.id);

      // Get first page
      const page1 = await caller.feed.home({ limit: 2 });

      expect(page1.items.length).toBe(2);
      expect(page1.nextCursor).toBeDefined();

      // Get second page
      const page2 = await caller.feed.home({
        limit: 2,
        cursor: page1.nextCursor!,
      });

      expect(page2.items.length).toBe(1);
      expect(page2.nextCursor).toBeNull();
    });

    it("returns empty feed for user following nobody", async () => {
      const { user: viewer } = await createTestUser();

      const caller = createTestContext(viewer.id);

      const result = await caller.feed.home({ limit: 20 });

      expect(result.items.length).toBe(0);
      expect(result.nextCursor).toBeNull();
    });

    it("filters out deleted tweets", async () => {
      const { user: viewer } = await createTestUser();
      const { user: followed } = await createTestUser();

      // Follow user
      await prisma.follow.create({
        data: {
          followerId: viewer.id,
          followingId: followed.id,
        },
      });

      // Create tweet and delete it
      const tweet = await createTestTweet(followed.id, {
        content: "Deleted tweet",
      });
      await prisma.tweet.update({
        where: { id: tweet.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const caller = createTestContext(viewer.id);

      const result = await caller.feed.home({ limit: 20 });

      // Should not include deleted tweet
      expect(result.items.length).toBe(0);
    });
  });
});
