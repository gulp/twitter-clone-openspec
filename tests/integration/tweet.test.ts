/**
 * Integration tests for tweet router
 *
 * Tests tweet creation, replies, deletion, and retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/server/db";
import {
  cleanupDatabase,
  createTestContext,
  createTestUser,
  createTestTweet,
} from "./helpers";

describe("tweet router", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("create", () => {
    it("creates tweet and increments tweetCount", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      const tweet = await caller.tweet.create({
        content: "Hello, world!",
        mediaUrls: [],
      });

      expect(tweet.id).toBeDefined();
      expect(tweet.content).toBe("Hello, world!");
      expect(tweet.authorId).toBe(user.id);

      // Verify tweetCount was incremented
      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(updatedUser!.tweetCount).toBe(1);
    });

    it("creates reply and increments replyCount on parent", async () => {
      const { user: author } = await createTestUser();
      const { user: replier } = await createTestUser();

      const parentTweet = await createTestTweet(author.id, {
        content: "Original tweet",
      });

      const caller = createTestContext(replier.id);

      const reply = await caller.tweet.create({
        content: "This is a reply",
        parentId: parentTweet.id,
        mediaUrls: [],
      });

      expect(reply.parentId).toBe(parentTweet.id);

      // Verify replyCount was incremented on parent
      const updatedParent = await prisma.tweet.findUnique({
        where: { id: parentTweet.id },
      });
      expect(updatedParent!.replyCount).toBe(1);
    });

    it("returns 'Cannot reply to a deleted tweet' when replying to deleted tweet", async () => {
      const { user: author } = await createTestUser();
      const { user: replier } = await createTestUser();

      const parentTweet = await createTestTweet(author.id, {
        content: "Original tweet",
      });

      // Mark tweet as deleted
      await prisma.tweet.update({
        where: { id: parentTweet.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const caller = createTestContext(replier.id);

      await expect(
        caller.tweet.create({
          content: "This is a reply",
          parentId: parentTweet.id,
          mediaUrls: [],
        })
      ).rejects.toThrow("Cannot reply to a deleted tweet");
    });
  });

  describe("delete", () => {
    it("marks tweet as deleted and decrements counts", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id, {
        content: "Tweet to delete",
      });

      const caller = createTestContext(user.id);

      const result = await caller.tweet.delete({ tweetId: tweet.id });
      expect(result.success).toBe(true);

      // Verify tweet is marked as deleted
      const deletedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
      });
      expect(deletedTweet!.deleted).toBe(true);
      expect(deletedTweet!.deletedAt).toBeDefined();

      // Verify tweetCount was decremented
      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(updatedUser!.tweetCount).toBe(0);
    });

    it("returns 'You can only delete your own tweets' when deleting other's tweet", async () => {
      const { user: author } = await createTestUser();
      const { user: other } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Someone else's tweet",
      });

      const caller = createTestContext(other.id);

      await expect(caller.tweet.delete({ tweetId: tweet.id })).rejects.toThrow(
        "You can only delete your own tweets"
      );
    });
  });

  describe("getById", () => {
    it("returns tweet with author details", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id, {
        content: "Test tweet",
      });

      const caller = createTestContext(user.id);

      const result = await caller.tweet.getById({ tweetId: tweet.id });

      expect(result.id).toBe(tweet.id);
      expect(result.content).toBe("Test tweet");
      expect(result.author.id).toBe(user.id);
      expect(result.author.username).toBe(user.username);
    });

    it("returns 'Tweet not found' for deleted tweet", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id, {
        content: "Deleted tweet",
      });

      // Mark as deleted
      await prisma.tweet.update({
        where: { id: tweet.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const caller = createTestContext(user.id);

      await expect(caller.tweet.getById({ tweetId: tweet.id })).rejects.toThrow(
        "Tweet not found"
      );
    });

    it("returns 'Tweet not found' for non-existent tweet", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      await expect(
        caller.tweet.getById({ tweetId: "nonexistent" })
      ).rejects.toThrow("Tweet not found");
    });
  });

  describe("getUserTweets", () => {
    it("excludes replies and deleted tweets", async () => {
      const { user } = await createTestUser();

      // Create regular tweet
      const regularTweet = await createTestTweet(user.id, {
        content: "Regular tweet",
      });

      // Create reply
      await createTestTweet(user.id, {
        content: "Reply tweet",
        parentId: regularTweet.id,
      });

      // Create deleted tweet
      const deletedTweet = await createTestTweet(user.id, {
        content: "Deleted tweet",
      });
      await prisma.tweet.update({
        where: { id: deletedTweet.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const caller = createTestContext(user.id);

      const result = await caller.tweet.getUserTweets({
        userId: user.id,
        limit: 20,
      });

      // Should only return the regular tweet
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe(regularTweet.id);
      expect(result.items[0].content).toBe("Regular tweet");
    });

    it("supports cursor pagination", async () => {
      const { user } = await createTestUser();

      // Create 3 tweets
      await createTestTweet(user.id, { content: "Tweet 1" });
      await createTestTweet(user.id, { content: "Tweet 2" });
      await createTestTweet(user.id, { content: "Tweet 3" });

      const caller = createTestContext(user.id);

      // Get first page (limit 2)
      const page1 = await caller.tweet.getUserTweets({
        userId: user.id,
        limit: 2,
      });

      expect(page1.items.length).toBe(2);
      expect(page1.nextCursor).toBeTruthy();

      // Get second page using cursor
      const page2 = await caller.tweet.getUserTweets({
        userId: user.id,
        limit: 2,
        cursor: page1.nextCursor!,
      });

      expect(page2.items.length).toBe(1);
      expect(page2.nextCursor).toBeNull();

      // Verify no overlap
      const allIds = [...page1.items, ...page2.items].map((t) => t.id);
      expect(new Set(allIds).size).toBe(3);
    });
  });

  describe("getReplies", () => {
    it("returns replies to a tweet", async () => {
      const { user: author } = await createTestUser();
      const { user: replier1 } = await createTestUser();
      const { user: replier2 } = await createTestUser();

      const parentTweet = await createTestTweet(author.id, {
        content: "Original tweet",
      });

      // Create replies
      await createTestTweet(replier1.id, {
        content: "Reply 1",
        parentId: parentTweet.id,
      });
      await createTestTweet(replier2.id, {
        content: "Reply 2",
        parentId: parentTweet.id,
      });

      const caller = createTestContext(author.id);

      const result = await caller.tweet.getReplies({
        tweetId: parentTweet.id,
        limit: 20,
      });

      expect(result.items.length).toBe(2);
      expect(result.items.map((r) => r.content)).toContain("Reply 1");
      expect(result.items.map((r) => r.content)).toContain("Reply 2");
    });

    it("excludes deleted replies", async () => {
      const { user: author } = await createTestUser();
      const { user: replier } = await createTestUser();

      const parentTweet = await createTestTweet(author.id, {
        content: "Original tweet",
      });

      // Create reply and delete it
      const reply = await createTestTweet(replier.id, {
        content: "Deleted reply",
        parentId: parentTweet.id,
      });
      await prisma.tweet.update({
        where: { id: reply.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const caller = createTestContext(author.id);

      const result = await caller.tweet.getReplies({
        tweetId: parentTweet.id,
        limit: 20,
      });

      expect(result.items.length).toBe(0);
    });
  });
});
