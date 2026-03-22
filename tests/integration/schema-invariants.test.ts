/**
 * Integration tests for database schema invariants
 *
 * Tests CHECK constraints, generated columns, and business rules
 * enforced at the schema level against the real PostgreSQL database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanupDatabase, createTestContext, createTestUser, createTestTweet } from "./helpers";
import { prisma } from "@/server/db";

describe("schema invariants", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("denormalized count constraints", () => {
    it("prevents negative followerCount via CHECK constraint", async () => {
      const { user } = await createTestUser();

      // Attempt to set negative followerCount directly
      await expect(
        prisma.$executeRaw`
          UPDATE "User"
          SET "followerCount" = -1
          WHERE id = ${user.id}
        `
      ).rejects.toThrow(/User_counts_nonneg|check constraint/i);
    });

    it("prevents negative followingCount via CHECK constraint", async () => {
      const { user } = await createTestUser();

      await expect(
        prisma.$executeRaw`
          UPDATE "User"
          SET "followingCount" = -1
          WHERE id = ${user.id}
        `
      ).rejects.toThrow(/User_counts_nonneg|check constraint/i);
    });

    it("prevents negative tweetCount via CHECK constraint", async () => {
      const { user } = await createTestUser();

      await expect(
        prisma.$executeRaw`
          UPDATE "User"
          SET "tweetCount" = -1
          WHERE id = ${user.id}
        `
      ).rejects.toThrow(/User_counts_nonneg|check constraint/i);
    });

    it("prevents negative likeCount via CHECK constraint", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id);

      await expect(
        prisma.$executeRaw`
          UPDATE "Tweet"
          SET "likeCount" = -1
          WHERE id = ${tweet.id}
        `
      ).rejects.toThrow(/Tweet_counts_nonneg|check constraint/i);
    });

    it("prevents negative retweetCount via CHECK constraint", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id);

      await expect(
        prisma.$executeRaw`
          UPDATE "Tweet"
          SET "retweetCount" = -1
          WHERE id = ${tweet.id}
        `
      ).rejects.toThrow(/Tweet_counts_nonneg|check constraint/i);
    });

    it("prevents negative replyCount via CHECK constraint", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id);

      await expect(
        prisma.$executeRaw`
          UPDATE "Tweet"
          SET "replyCount" = -1
          WHERE id = ${tweet.id}
        `
      ).rejects.toThrow(/Tweet_counts_nonneg|check constraint/i);
    });

    it("allows zero and positive counts", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id);

      // All counts should be 0 by default and valid
      const fetchedUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { followerCount: true, followingCount: true, tweetCount: true },
      });

      expect(fetchedUser).toBeDefined();
      expect(fetchedUser!.followerCount).toBe(0);
      expect(fetchedUser!.followingCount).toBe(0);
      expect(fetchedUser!.tweetCount).toBe(1); // createTestTweet increments tweetCount

      const fetchedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
        select: { likeCount: true, retweetCount: true, replyCount: true },
      });

      expect(fetchedTweet).toBeDefined();
      expect(fetchedTweet!.likeCount).toBe(0);
      expect(fetchedTweet!.retweetCount).toBe(0);
      expect(fetchedTweet!.replyCount).toBe(0);

      // Positive counts should be allowed
      await prisma.user.update({
        where: { id: user.id },
        data: { followerCount: 10 },
      });

      const updated = await prisma.user.findUnique({
        where: { id: user.id },
        select: { followerCount: true },
      });

      expect(updated).toBeDefined();
      expect(updated!.followerCount).toBe(10);
    });
  });

  describe("deleted/deletedAt consistency constraint", () => {
    it("prevents deleted=false with non-null deletedAt", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id);

      // Attempt to set deleted=false but deletedAt is not null
      await expect(
        prisma.$executeRaw`
          UPDATE "Tweet"
          SET "deleted" = false, "deletedAt" = NOW()
          WHERE id = ${tweet.id}
        `
      ).rejects.toThrow(/Tweet_deleted_consistency|check constraint/i);
    });

    it("prevents deleted=true with null deletedAt", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id);

      // Attempt to set deleted=true but deletedAt is null
      await expect(
        prisma.$executeRaw`
          UPDATE "Tweet"
          SET "deleted" = true, "deletedAt" = NULL
          WHERE id = ${tweet.id}
        `
      ).rejects.toThrow(/Tweet_deleted_consistency|check constraint/i);
    });

    it("allows deleted=false with null deletedAt (live tweet)", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id);

      // Default state should be valid
      expect(tweet.deleted).toBe(false);
      expect(tweet.deletedAt).toBeNull();
    });

    it("allows deleted=true with non-null deletedAt (deleted tweet)", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id);

      // Soft delete
      await prisma.tweet.update({
        where: { id: tweet.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const deletedTweet = await prisma.tweet.findUnique({
        where: { id: tweet.id },
      });

      expect(deletedTweet).toBeDefined();
      expect(deletedTweet!.deleted).toBe(true);
      expect(deletedTweet!.deletedAt).toBeTruthy();
    });
  });

  describe("tweet content or media constraint", () => {
    it("prevents tweet with empty content and no media", async () => {
      const { user } = await createTestUser();

      await expect(
        prisma.tweet.create({
          data: {
            authorId: user.id,
            content: "",
            mediaUrls: [],
          },
        })
      ).rejects.toThrow(/Tweet_content_or_media|check constraint/i);
    });

    it("allows tweet with content and no media", async () => {
      const { user } = await createTestUser();

      const tweet = await prisma.tweet.create({
        data: {
          authorId: user.id,
          content: "Hello world",
          mediaUrls: [],
        },
      });

      expect(tweet.content).toBe("Hello world");
      expect(tweet.mediaUrls).toHaveLength(0);
    });

    it("allows tweet with media and no content", async () => {
      const { user } = await createTestUser();
      const s3PublicUrl = process.env.S3_PUBLIC_URL || "http://localhost:9000/twitter-clone";

      const tweet = await prisma.tweet.create({
        data: {
          authorId: user.id,
          content: " ", // Single space to satisfy VARCHAR(280) NOT NULL, but content_or_media allows it if media exists
          mediaUrls: [`${s3PublicUrl}/tweet/${user.id}/image.jpg`],
        },
      });

      expect(tweet.mediaUrls).toHaveLength(1);
    });

    it("allows tweet with both content and media", async () => {
      const { user } = await createTestUser();
      const s3PublicUrl = process.env.S3_PUBLIC_URL || "http://localhost:9000/twitter-clone";

      const tweet = await prisma.tweet.create({
        data: {
          authorId: user.id,
          content: "Check out this image",
          mediaUrls: [`${s3PublicUrl}/tweet/${user.id}/image.jpg`],
        },
      });

      expect(tweet.content).toBe("Check out this image");
      expect(tweet.mediaUrls).toHaveLength(1);
    });
  });

  describe("search_vector generated column", () => {
    it("populates search_vector on INSERT", async () => {
      const { user } = await createTestUser();

      const tweet = await prisma.tweet.create({
        data: {
          authorId: user.id,
          content: "searchable tweet content",
          mediaUrls: [],
        },
      });

      // Query search_vector using raw SQL
      const result = await prisma.$queryRaw<Array<{ search_vector: string }>>`
        SELECT search_vector::text
        FROM "Tweet"
        WHERE id = ${tweet.id}
      `;

      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
      expect(result[0]!.search_vector).toBeTruthy();
      expect(result[0]!.search_vector).toContain("searchabl"); // PostgreSQL stems to "searchabl"
      expect(result[0]!.search_vector).toContain("tweet");
      expect(result[0]!.search_vector).toContain("content");
    });

    it("updates search_vector on UPDATE", async () => {
      const { user } = await createTestUser();

      const tweet = await prisma.tweet.create({
        data: {
          authorId: user.id,
          content: "original content",
          mediaUrls: [],
        },
      });

      // Update content
      await prisma.tweet.update({
        where: { id: tweet.id },
        data: { content: "updated content with new keywords" },
      });

      // Query updated search_vector
      const result = await prisma.$queryRaw<Array<{ search_vector: string }>>`
        SELECT search_vector::text
        FROM "Tweet"
        WHERE id = ${tweet.id}
      `;

      expect(result[0]).toBeDefined();
      expect(result[0]!.search_vector).toContain("updat"); // "updated" stemmed
      expect(result[0]!.search_vector).toContain("keyword");
      expect(result[0]!.search_vector).not.toContain("origin"); // "original" should be gone
    });

    it("enables full-text search via search_vector", async () => {
      const { user } = await createTestUser();

      await prisma.tweet.create({
        data: {
          authorId: user.id,
          content: "TypeScript is awesome for type safety",
          mediaUrls: [],
        },
      });

      await prisma.tweet.create({
        data: {
          authorId: user.id,
          content: "JavaScript is flexible but dynamic",
          mediaUrls: [],
        },
      });

      // Search for "typescript"
      const results = await prisma.$queryRaw<Array<{ id: string; content: string }>>`
        SELECT id, content
        FROM "Tweet"
        WHERE search_vector @@ to_tsquery('english', 'typescript')
      `;

      expect(results).toHaveLength(1);
      expect(results[0]).toBeDefined();
      expect(results[0]!.content).toContain("TypeScript");
    });
  });

  describe("deleted tweet filtering", () => {
    it("soft-deleted tweets excluded from getById", async () => {
      const { user } = await createTestUser();
      const tweet = await createTestTweet(user.id, { content: "To be deleted" });

      // Soft delete the tweet
      await prisma.tweet.update({
        where: { id: tweet.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const caller = createTestContext(user.id);

      // getById should throw NOT_FOUND for deleted tweets
      await expect(caller.tweet.getById({ tweetId: tweet.id })).rejects.toThrow("Tweet not found");
    });

    it("soft-deleted tweets excluded from feed", async () => {
      const { user: viewer } = await createTestUser();
      const { user: author } = await createTestUser();

      // Viewer must follow author for tweets to appear in home feed
      await prisma.follow.create({
        data: { followerId: viewer.id, followingId: author.id },
      });

      const tweet1 = await createTestTweet(author.id, { content: "Live tweet" });
      const tweet2 = await createTestTweet(author.id, { content: "Deleted tweet" });

      // Soft delete tweet2
      await prisma.tweet.update({
        where: { id: tweet2.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const caller = createTestContext(viewer.id);

      // Home feed should only show live tweet
      const feed = await caller.feed.home({ limit: 10 });

      expect(feed.items).toHaveLength(1);
      expect(feed.items[0]).toBeDefined();
      expect(feed.items[0]!.id).toBe(tweet1.id);
      expect(feed.items.find((t) => t.id === tweet2.id)).toBeUndefined();
    });

    it("soft-deleted tweets excluded from search", async () => {
      const { user } = await createTestUser();
      const tweet1 = await createTestTweet(user.id, { content: "searchable live tweet" });
      const tweet2 = await createTestTweet(user.id, { content: "searchable deleted tweet" });

      // Soft delete tweet2
      await prisma.tweet.update({
        where: { id: tweet2.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const caller = createTestContext();

      // Search should only return live tweet
      const results = await caller.search.tweets({ query: "searchable", limit: 10 });

      expect(results.items).toHaveLength(1);
      expect(results.items[0]).toBeDefined();
      expect(results.items[0]!.id).toBe(tweet1.id);
    });

    it("soft-deleted tweets excluded from user timeline", async () => {
      const { user } = await createTestUser();
      const tweet1 = await createTestTweet(user.id, { content: "Live tweet" });
      const tweet2 = await createTestTweet(user.id, { content: "Deleted tweet" });

      // Soft delete tweet2
      await prisma.tweet.update({
        where: { id: tweet2.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const caller = createTestContext();

      // User timeline should only show live tweet
      const timeline = await caller.tweet.getUserTweets({ userId: user.id, limit: 10 });

      expect(timeline.items).toHaveLength(1);
      expect(timeline.items[0]).toBeDefined();
      expect(timeline.items[0]!.id).toBe(tweet1.id);
    });
  });
});
