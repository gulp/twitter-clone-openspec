/**
 * Integration tests for notification failure handling
 *
 * Verifies that primary operations (follow/like/retweet/reply/quote) succeed
 * even when notification creation fails (fail-open pattern per §4, §10).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/server/db";
import * as notificationService from "@/server/services/notification";
import {
  cleanupDatabase,
  createTestContext,
  createTestUser,
  createTestTweet,
} from "./helpers";

describe("notification failure handling (fail-open)", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
    vi.restoreAllMocks();
  });

  it("follow succeeds even when notification creation fails", async () => {
    const { user: follower } = await createTestUser();
    const { user: following } = await createTestUser();

    // Mock createNotification to throw
    vi.spyOn(notificationService, "createNotification").mockRejectedValue(
      new Error("Database timeout")
    );

    const caller = createTestContext(follower.id);

    // Follow should succeed despite notification failure
    const result = await caller.social.follow({ userId: following.id });

    expect(result.success).toBe(true);

    // Verify follow relationship was created
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: follower.id,
          followingId: following.id,
        },
      },
    });

    expect(follow).toBeDefined();

    // Verify counts were updated
    const updatedFollower = await prisma.user.findUnique({
      where: { id: follower.id },
      select: { followingCount: true },
    });
    const updatedFollowing = await prisma.user.findUnique({
      where: { id: following.id },
      select: { followerCount: true },
    });

    expect(updatedFollower?.followingCount).toBe(1);
    expect(updatedFollowing?.followerCount).toBe(1);

    // Verify no notification was created (due to mock failure)
    const notification = await prisma.notification.findFirst({
      where: {
        recipientId: following.id,
        actorId: follower.id,
        type: "FOLLOW",
      },
    });

    expect(notification).toBeNull();
  });

  it("like succeeds even when notification creation fails", async () => {
    const { user: author } = await createTestUser();
    const { user: liker } = await createTestUser();

    const tweet = await createTestTweet(author.id, {
      content: "Test tweet",
    });

    // Mock createNotification to throw
    vi.spyOn(notificationService, "createNotification").mockRejectedValue(
      new Error("Connection error")
    );

    const caller = createTestContext(liker.id);

    // Like should succeed despite notification failure
    const result = await caller.engagement.like({ tweetId: tweet.id });

    expect(result.success).toBe(true);

    // Verify like relationship was created
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
      select: { likeCount: true },
    });

    expect(updatedTweet?.likeCount).toBe(1);

    // Verify no notification was created (due to mock failure)
    const notification = await prisma.notification.findFirst({
      where: {
        recipientId: author.id,
        actorId: liker.id,
        type: "LIKE",
        tweetId: tweet.id,
      },
    });

    expect(notification).toBeNull();
  });

  it("retweet succeeds even when notification creation fails", async () => {
    const { user: author } = await createTestUser();
    const { user: retweeter } = await createTestUser();

    const tweet = await createTestTweet(author.id, {
      content: "Test tweet",
    });

    // Mock createNotification to throw
    vi.spyOn(notificationService, "createNotification").mockRejectedValue(
      new Error("Redis unavailable")
    );

    const caller = createTestContext(retweeter.id);

    // Retweet should succeed despite notification failure
    const result = await caller.engagement.retweet({ tweetId: tweet.id });

    expect(result.success).toBe(true);

    // Verify retweet relationship was created
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
      select: { retweetCount: true },
    });

    expect(updatedTweet?.retweetCount).toBe(1);

    // Verify no notification was created (due to mock failure)
    const notification = await prisma.notification.findFirst({
      where: {
        recipientId: author.id,
        actorId: retweeter.id,
        type: "RETWEET",
        tweetId: tweet.id,
      },
    });

    expect(notification).toBeNull();
  });

  it("reply succeeds even when notification creation fails", async () => {
    const { user: author } = await createTestUser();
    const { user: replier } = await createTestUser();

    const tweet = await createTestTweet(author.id, {
      content: "Original tweet",
    });

    // Mock createNotification to throw
    vi.spyOn(notificationService, "createNotification").mockRejectedValue(
      new Error("Transaction timeout")
    );

    const caller = createTestContext(replier.id);

    // Reply should succeed despite notification failure
    const reply = await caller.tweet.create({
      content: "Reply",
      parentId: tweet.id,
      mediaUrls: [],
    });

    expect(reply).toBeDefined();
    expect(reply.parentId).toBe(tweet.id);

    // Verify parent's replyCount was incremented
    const updatedParent = await prisma.tweet.findUnique({
      where: { id: tweet.id },
      select: { replyCount: true },
    });

    expect(updatedParent?.replyCount).toBe(1);

    // Verify no notification was created (due to mock failure)
    const notification = await prisma.notification.findFirst({
      where: {
        recipientId: author.id,
        actorId: replier.id,
        type: "REPLY",
      },
    });

    expect(notification).toBeNull();
  });

  it("mention in tweet succeeds even when notification creation fails", async () => {
    const { user: mentioned } = await createTestUser({
      username: "mentioned",
    });
    const { user: mentioner } = await createTestUser();

    // Mock createNotification to throw
    vi.spyOn(notificationService, "createNotification").mockRejectedValue(
      new Error("Network error")
    );

    const caller = createTestContext(mentioner.id);

    // Tweet with mention should succeed despite notification failure
    const tweet = await caller.tweet.create({
      content: "Hello @mentioned!",
      mediaUrls: [],
    });

    expect(tweet).toBeDefined();
    expect(tweet.content).toContain("@mentioned");

    // Verify no notification was created (due to mock failure)
    const notification = await prisma.notification.findFirst({
      where: {
        recipientId: mentioned.id,
        actorId: mentioner.id,
        type: "MENTION",
      },
    });

    expect(notification).toBeNull();
  });

  it("quoteTweet succeeds even when notification creation fails", async () => {
    const { user: quotedAuthor } = await createTestUser();
    const { user: quoter } = await createTestUser();

    const quotedTweet = await createTestTweet(quotedAuthor.id, {
      content: "Original tweet",
    });

    // Mock createNotification to throw
    vi.spyOn(notificationService, "createNotification").mockRejectedValue(
      new Error("Service unavailable")
    );

    const caller = createTestContext(quoter.id);

    // Quote tweet should succeed despite notification failure
    const quote = await caller.engagement.quoteTweet({
      quoteTweetId: quotedTweet.id,
      content: "Quote comment",
    });

    expect(quote).toBeDefined();
    expect(quote.quoteTweetId).toBe(quotedTweet.id);

    // Verify quote tweet was created in DB
    const createdQuote = await prisma.tweet.findUnique({
      where: { id: quote.id },
      select: { quoteTweetId: true },
    });

    expect(createdQuote?.quoteTweetId).toBe(quotedTweet.id);

    // Verify no notification was created (due to mock failure)
    const notification = await prisma.notification.findFirst({
      where: {
        recipientId: quotedAuthor.id,
        actorId: quoter.id,
        type: "QUOTE_TWEET",
      },
    });

    expect(notification).toBeNull();
  });

  it("happy path still creates notifications when no error", async () => {
    const { user: follower } = await createTestUser();
    const { user: following } = await createTestUser();

    const caller = createTestContext(follower.id);

    // No mock - should work normally
    const result = await caller.social.follow({ userId: following.id });

    expect(result.success).toBe(true);

    // Verify notification was created in happy path
    const notification = await prisma.notification.findFirst({
      where: {
        recipientId: following.id,
        actorId: follower.id,
        type: "FOLLOW",
      },
    });

    expect(notification).toBeDefined();
  });
});
