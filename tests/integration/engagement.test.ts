/**
 * Integration tests for engagement router
 *
 * Tests like, unlike, retweet, undo retweet, quote tweet, and engagement queries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/server/db";
import {
  cleanupDatabase,
  createTestContext,
  createTestUser,
  createTestTweet,
} from "./helpers";

describe("engagement router", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("like", () => {
    it("creates like and increments count", async () => {
      const { user: author } = await createTestUser();
      const { user: liker } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Tweet to like",
      });

      const caller = createTestContext(liker.id);

      const result = await caller.engagement.like({ tweetId: tweet.id });

      expect(result.success).toBe(true);

      // Verify like was created
      const like = await prisma.like.findUnique({
        where: {
          userId_tweetId: {
            userId: liker.id,
            tweetId: tweet.id,
          },
        },
      });
      expect(like).toBeDefined();

      // Verify likeCount was incremented
      const updatedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
      });
      expect(updatedTweet!.likeCount).toBe(1);

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: author.id,
          actorId: liker.id,
          type: "LIKE",
          tweetId: tweet.id,
        },
      });
      expect(notification).toBeDefined();
    });

    it("is idempotent (double like succeeds)", async () => {
      const { user: author } = await createTestUser();
      const { user: liker } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Tweet to like",
      });

      const caller = createTestContext(liker.id);

      // First like
      await caller.engagement.like({ tweetId: tweet.id });

      // Second like (should succeed idempotently)
      const result = await caller.engagement.like({ tweetId: tweet.id });
      expect(result.success).toBe(true);

      // Verify count didn't double-increment
      const updatedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
      });
      expect(updatedTweet!.likeCount).toBe(1);
    });

    it("suppresses self-notification when liking own tweet", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id, {
        content: "My tweet",
      });

      const caller = createTestContext(user.id);

      await caller.engagement.like({ tweetId: tweet.id });

      // Verify no notification was created (self-suppression)
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: user.id,
          actorId: user.id,
          type: "LIKE",
          tweetId: tweet.id,
        },
      });
      expect(notification).toBeNull();
    });
  });

  describe("unlike", () => {
    it("removes like and decrements count", async () => {
      const { user: author } = await createTestUser();
      const { user: liker } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Tweet to unlike",
      });

      // Create like
      await prisma.like.create({
        data: {
          userId: liker.id,
          tweetId: tweet.id,
        },
      });

      // Increment count
      await prisma.tweet.update({
        where: { id: tweet.id },
        data: { likeCount: 1 },
      });

      const caller = createTestContext(liker.id);

      const result = await caller.engagement.unlike({ tweetId: tweet.id });

      expect(result.success).toBe(true);

      // Verify like was removed
      const like = await prisma.like.findUnique({
        where: {
          userId_tweetId: {
            userId: liker.id,
            tweetId: tweet.id,
          },
        },
      });
      expect(like).toBeNull();

      // Verify count was decremented
      const updatedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
      });
      expect(updatedTweet!.likeCount).toBe(0);
    });

    it("is idempotent (unlike non-liked tweet succeeds)", async () => {
      const { user: author } = await createTestUser();
      const { user: unliker } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Never liked tweet",
      });

      const caller = createTestContext(unliker.id);

      const result = await caller.engagement.unlike({ tweetId: tweet.id });

      expect(result.success).toBe(true);
    });
  });

  describe("retweet", () => {
    it("creates retweet and increments count", async () => {
      const { user: author } = await createTestUser();
      const { user: retweeter } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Tweet to retweet",
      });

      const caller = createTestContext(retweeter.id);

      const result = await caller.engagement.retweet({ tweetId: tweet.id });

      expect(result.success).toBe(true);

      // Verify retweet was created
      const retweet = await prisma.retweet.findUnique({
        where: {
          userId_tweetId: {
            userId: retweeter.id,
            tweetId: tweet.id,
          },
        },
      });
      expect(retweet).toBeDefined();

      // Verify retweetCount was incremented
      const updatedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
      });
      expect(updatedTweet!.retweetCount).toBe(1);

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: author.id,
          actorId: retweeter.id,
          type: "RETWEET",
          tweetId: tweet.id,
        },
      });
      expect(notification).toBeDefined();
    });

    it("returns 'Cannot retweet your own tweet' for self-retweet", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id, {
        content: "My tweet",
      });

      const caller = createTestContext(user.id);

      await expect(
        caller.engagement.retweet({ tweetId: tweet.id })
      ).rejects.toThrow("Cannot retweet your own tweet");
    });

    it("is idempotent (double retweet succeeds)", async () => {
      const { user: author } = await createTestUser();
      const { user: retweeter } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Tweet to retweet",
      });

      const caller = createTestContext(retweeter.id);

      // First retweet
      await caller.engagement.retweet({ tweetId: tweet.id });

      // Second retweet (should succeed idempotently)
      const result = await caller.engagement.retweet({ tweetId: tweet.id });
      expect(result.success).toBe(true);

      // Verify count didn't double-increment
      const updatedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
      });
      expect(updatedTweet!.retweetCount).toBe(1);
    });
  });

  describe("undoRetweet", () => {
    it("removes retweet and decrements count", async () => {
      const { user: author } = await createTestUser();
      const { user: retweeter } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Tweet to undo retweet",
      });

      // Create retweet
      await prisma.retweet.create({
        data: {
          userId: retweeter.id,
          tweetId: tweet.id,
        },
      });

      // Increment count
      await prisma.tweet.update({
        where: { id: tweet.id },
        data: { retweetCount: 1 },
      });

      const caller = createTestContext(retweeter.id);

      const result = await caller.engagement.undoRetweet({ tweetId: tweet.id });

      expect(result.success).toBe(true);

      // Verify retweet was removed
      const retweet = await prisma.retweet.findUnique({
        where: {
          userId_tweetId: {
            userId: retweeter.id,
            tweetId: tweet.id,
          },
        },
      });
      expect(retweet).toBeNull();

      // Verify count was decremented
      const updatedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
      });
      expect(updatedTweet!.retweetCount).toBe(0);
    });
  });

  describe("quoteTweet", () => {
    it("creates new tweet with quoteTweetId and notifies quoted author", async () => {
      const { user: quotedAuthor } = await createTestUser();
      const { user: quoter } = await createTestUser();

      const quotedTweet = await createTestTweet(quotedAuthor.id, {
        content: "Original tweet",
      });

      const caller = createTestContext(quoter.id);

      const result = await caller.engagement.quoteTweet({
        quoteTweetId: quotedTweet.id,
        content: "Quote comment",
      });

      expect(result.id).toBeDefined();
      expect(result.content).toBe("Quote comment");
      expect(result.quoteTweetId).toBe(quotedTweet.id);

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: quotedAuthor.id,
          actorId: quoter.id,
          type: "QUOTE_TWEET",
          tweetId: result.id,
        },
      });
      expect(notification).toBeDefined();
    });
  });

  describe("getUserLikes", () => {
    it("returns tweets liked by user", async () => {
      const { user: liker } = await createTestUser();
      const { user: author1 } = await createTestUser();
      const { user: author2 } = await createTestUser();

      const tweet1 = await createTestTweet(author1.id, {
        content: "Liked tweet 1",
      });
      const tweet2 = await createTestTweet(author2.id, {
        content: "Liked tweet 2",
      });

      // Create likes
      await prisma.like.createMany({
        data: [
          { userId: liker.id, tweetId: tweet1.id },
          { userId: liker.id, tweetId: tweet2.id },
        ],
      });

      const caller = createTestContext(liker.id);

      const result = await caller.engagement.getUserLikes({
        userId: liker.id,
        limit: 20,
      });

      expect(result.items.length).toBe(2);
      expect(result.items.map((t) => t.id)).toContain(tweet1.id);
      expect(result.items.map((t) => t.id)).toContain(tweet2.id);
    });
  });
});
