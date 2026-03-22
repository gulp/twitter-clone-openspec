/**
 * Integration tests for notification router
 *
 * Tests notification creation, listing, marking as read, and unread count.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/server/db";
import {
  cleanupDatabase,
  createTestContext,
  createTestUser,
  createTestTweet,
} from "./helpers";

describe("notification router", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("notification types", () => {
    it("creates LIKE notification correctly", async () => {
      const { user: author } = await createTestUser();
      const { user: liker } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Test tweet",
      });

      const caller = createTestContext(liker.id);

      // Like creates notification
      await caller.engagement.like({ tweetId: tweet.id });

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
      expect(notification!.read).toBe(false);
    });

    it("creates RETWEET notification correctly", async () => {
      const { user: author } = await createTestUser();
      const { user: retweeter } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Test tweet",
      });

      const caller = createTestContext(retweeter.id);

      // Retweet creates notification
      await caller.engagement.retweet({ tweetId: tweet.id });

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

    it("creates FOLLOW notification correctly", async () => {
      const { user: follower } = await createTestUser();
      const { user: following } = await createTestUser();

      const caller = createTestContext(follower.id);

      // Follow creates notification
      await caller.social.follow({ userId: following.id });

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: following.id,
          actorId: follower.id,
          type: "FOLLOW",
        },
      });

      expect(notification).toBeDefined();
    });

    it("creates REPLY notification correctly", async () => {
      const { user: author } = await createTestUser();
      const { user: replier } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Original tweet",
      });

      const caller = createTestContext(replier.id);

      // Reply creates notification
      await caller.tweet.create({
        content: "Reply",
        parentId: tweet.id,
        mediaUrls: [],
      });

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: author.id,
          actorId: replier.id,
          type: "REPLY",
        },
      });

      expect(notification).toBeDefined();
    });

    it("creates MENTION notification correctly", async () => {
      const { user: mentioned } = await createTestUser({
        username: "mentioned",
      });
      const { user: mentioner } = await createTestUser();

      const caller = createTestContext(mentioner.id);

      // Tweet with mention creates notification
      await caller.tweet.create({
        content: "Hello @mentioned!",
        mediaUrls: [],
      });

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: mentioned.id,
          actorId: mentioner.id,
          type: "MENTION",
        },
      });

      expect(notification).toBeDefined();
    });

    it("creates QUOTE_TWEET notification correctly", async () => {
      const { user: quotedAuthor } = await createTestUser();
      const { user: quoter } = await createTestUser();

      const quotedTweet = await createTestTweet(quotedAuthor.id, {
        content: "Original tweet",
      });

      const caller = createTestContext(quoter.id);

      // Quote tweet creates notification
      await caller.engagement.quoteTweet({
        quoteTweetId: quotedTweet.id,
        content: "Quote comment",
      });

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: quotedAuthor.id,
          actorId: quoter.id,
          type: "QUOTE_TWEET",
        },
      });

      expect(notification).toBeDefined();
    });
  });

  describe("self-notification suppression", () => {
    it("suppresses self-notification when liking own tweet", async () => {
      const { user } = await createTestUser();

      const tweet = await createTestTweet(user.id, {
        content: "My tweet",
      });

      const caller = createTestContext(user.id);

      await caller.engagement.like({ tweetId: tweet.id });

      // Verify no notification was created
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

  describe("duplicate dedupeKey handling", () => {
    it("handles duplicate dedupeKey without error", async () => {
      const { user: author } = await createTestUser();
      const { user: liker } = await createTestUser();

      const tweet = await createTestTweet(author.id, {
        content: "Test tweet",
      });

      const caller = createTestContext(liker.id);

      // Like twice (idempotent) - should not error on duplicate notification
      await caller.engagement.like({ tweetId: tweet.id });
      await caller.engagement.like({ tweetId: tweet.id });

      // Verify only one notification exists
      const notifications = await prisma.notification.findMany({
        where: {
          recipientId: author.id,
          actorId: liker.id,
          type: "LIKE",
          tweetId: tweet.id,
        },
      });

      expect(notifications.length).toBe(1);
    });
  });

  describe("list", () => {
    it("returns paginated notifications", async () => {
      const { user: recipient } = await createTestUser();
      const { user: actor } = await createTestUser();

      // Create notification
      await prisma.notification.create({
        data: {
          recipientId: recipient.id,
          actorId: actor.id,
          type: "FOLLOW",
        },
      });

      const caller = createTestContext(recipient.id);

      const result = await caller.notification.list({ limit: 20 });

      expect(result.items.length).toBe(1);
      expect(result.items[0].type).toBe("FOLLOW");
    });
  });

  describe("markRead", () => {
    it("marks notification as read", async () => {
      const { user: recipient } = await createTestUser();
      const { user: actor } = await createTestUser();

      const notification = await prisma.notification.create({
        data: {
          recipientId: recipient.id,
          actorId: actor.id,
          type: "FOLLOW",
        },
      });

      const caller = createTestContext(recipient.id);

      await caller.notification.markRead({
        id: notification.id,
      });

      // Verify notification was marked as read
      const updated = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      expect(updated!.read).toBe(true);
    });
  });

  describe("markAllRead", () => {
    it("marks all notifications as read", async () => {
      const { user: recipient } = await createTestUser();
      const { user: actor } = await createTestUser();

      // Create multiple notifications
      await prisma.notification.createMany({
        data: [
          {
            recipientId: recipient.id,
            actorId: actor.id,
            type: "FOLLOW",
          },
          {
            recipientId: recipient.id,
            actorId: actor.id,
            type: "LIKE",
          },
        ],
      });

      const caller = createTestContext(recipient.id);

      await caller.notification.markAllRead();

      // Verify all notifications were marked as read
      const unreadCount = await prisma.notification.count({
        where: {
          recipientId: recipient.id,
          read: false,
        },
      });

      expect(unreadCount).toBe(0);
    });
  });

  describe("unreadCount", () => {
    it("returns accurate unread count", async () => {
      const { user: recipient } = await createTestUser();
      const { user: actor } = await createTestUser();

      // Create notifications (2 unread, 1 read)
      await prisma.notification.createMany({
        data: [
          {
            recipientId: recipient.id,
            actorId: actor.id,
            type: "FOLLOW",
            read: false,
          },
          {
            recipientId: recipient.id,
            actorId: actor.id,
            type: "LIKE",
            read: false,
          },
          {
            recipientId: recipient.id,
            actorId: actor.id,
            type: "RETWEET",
            read: true,
          },
        ],
      });

      const caller = createTestContext(recipient.id);

      const result = await caller.notification.unreadCount();

      expect(result.count).toBe(2);
    });
  });
});
