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

    it("prevents cross-page duplicates when tweet appears via original and retweet", async () => {
      // Regression test for tw-3ta: cursor filter must apply AFTER deduplication
      // to prevent a tweet from appearing on multiple pages
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

      // Create 3 tweets by author (to create pagination)
      // Add small delays to ensure distinct timestamps for deterministic ordering
      const tweet1 = await createTestTweet(author.id, { content: "Tweet 1" });
      await new Promise(resolve => setTimeout(resolve, 10));
      const tweet2 = await createTestTweet(author.id, { content: "Tweet 2" });
      await new Promise(resolve => setTimeout(resolve, 10));
      const tweet3 = await createTestTweet(author.id, { content: "Tweet 3" });
      await new Promise(resolve => setTimeout(resolve, 10));

      // Retweet tweet2 (making it appear in feed twice: as original and retweet)
      await prisma.retweet.create({
        data: {
          userId: retweeter.id,
          tweetId: tweet2.id,
        },
      });

      const caller = createTestContext(viewer.id);

      // Get first page with limit=2
      const page1 = await caller.feed.home({ limit: 2 });
      expect(page1.items.length).toBe(2);

      // Get second page
      const page2 = await caller.feed.home({
        limit: 2,
        cursor: page1.nextCursor!,
      });

      // Collect all tweet IDs across both pages
      const allTweetIds = [
        ...page1.items.map((item) => item.id),
        ...page2.items.map((item) => item.id),
      ];

      // Critical assertion: no tweet should appear on multiple pages
      const uniqueTweetIds = new Set(allTweetIds);
      expect(uniqueTweetIds.size).toBe(allTweetIds.length);

      // Verify we got all 3 tweets exactly once
      expect(uniqueTweetIds.size).toBe(3);
      expect(uniqueTweetIds.has(tweet1.id)).toBe(true);
      expect(uniqueTweetIds.has(tweet2.id)).toBe(true);
      expect(uniqueTweetIds.has(tweet3.id)).toBe(true);
    });
  });
});
