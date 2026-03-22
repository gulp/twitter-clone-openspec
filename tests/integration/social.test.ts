/**
 * Integration tests for social router
 *
 * Tests follow/unfollow, followers/following lists, and suggestions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/server/db";
import { cleanupDatabase, createTestContext, createTestUser } from "./helpers";

describe("social router", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("follow", () => {
    it("creates follow relationship and increments counts", async () => {
      const { user: follower } = await createTestUser();
      const { user: following } = await createTestUser();

      const caller = createTestContext(follower.id);

      const result = await caller.social.follow({
        userId: following.id,
      });

      expect(result.success).toBe(true);

      // Verify follow relationship was created
      const followRel = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: follower.id,
            followingId: following.id,
          },
        },
      });
      expect(followRel).toBeDefined();

      // Verify counts were incremented
      const updatedFollower = await prisma.user.findUnique({
        where: { id: follower.id },
      });
      expect(updatedFollower!.followingCount).toBe(1);

      const updatedFollowing = await prisma.user.findUnique({
        where: { id: following.id },
      });
      expect(updatedFollowing!.followerCount).toBe(1);

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

    it("returns 'Cannot follow yourself' for self-follow", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      await expect(
        caller.social.follow({ userId: user.id })
      ).rejects.toThrow("Cannot follow yourself");
    });

    it("is idempotent (double follow succeeds)", async () => {
      const { user: follower } = await createTestUser();
      const { user: following } = await createTestUser();

      const caller = createTestContext(follower.id);

      // First follow
      await caller.social.follow({ userId: following.id });

      // Second follow (should succeed idempotently)
      const result = await caller.social.follow({ userId: following.id });
      expect(result.success).toBe(true);

      // Verify counts didn't double-increment
      const updatedFollower = await prisma.user.findUnique({
        where: { id: follower.id },
      });
      expect(updatedFollower!.followingCount).toBe(1);
    });
  });

  describe("unfollow", () => {
    it("removes follow relationship and decrements counts", async () => {
      const { user: follower } = await createTestUser();
      const { user: following } = await createTestUser();

      // Create follow relationship
      await prisma.follow.create({
        data: {
          followerId: follower.id,
          followingId: following.id,
        },
      });

      // Increment counts
      await prisma.user.update({
        where: { id: follower.id },
        data: { followingCount: 1 },
      });
      await prisma.user.update({
        where: { id: following.id },
        data: { followerCount: 1 },
      });

      const caller = createTestContext(follower.id);

      const result = await caller.social.unfollow({
        userId: following.id,
      });

      expect(result.success).toBe(true);

      // Verify follow relationship was removed
      const followRel = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: follower.id,
            followingId: following.id,
          },
        },
      });
      expect(followRel).toBeNull();

      // Verify counts were decremented
      const updatedFollower = await prisma.user.findUnique({
        where: { id: follower.id },
      });
      expect(updatedFollower!.followingCount).toBe(0);

      const updatedFollowing = await prisma.user.findUnique({
        where: { id: following.id },
      });
      expect(updatedFollowing!.followerCount).toBe(0);
    });

    it("is idempotent (unfollow non-followed user succeeds)", async () => {
      const { user: follower } = await createTestUser();
      const { user: notFollowing } = await createTestUser();

      const caller = createTestContext(follower.id);

      // Unfollow a user we never followed
      const result = await caller.social.unfollow({
        userId: notFollowing.id,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("getFollowers", () => {
    it("returns paginated list of followers", async () => {
      const { user: target } = await createTestUser();
      const { user: follower1 } = await createTestUser();
      const { user: follower2 } = await createTestUser();

      // Create follow relationships
      await prisma.follow.createMany({
        data: [
          { followerId: follower1.id, followingId: target.id },
          { followerId: follower2.id, followingId: target.id },
        ],
      });

      const caller = createTestContext(target.id);

      const result = await caller.social.getFollowers({
        userId: target.id,
        limit: 20,
      });

      expect(result.items.length).toBe(2);
      expect(result.items.map((u) => u.id)).toContain(follower1.id);
      expect(result.items.map((u) => u.id)).toContain(follower2.id);
    });

    it("supports cursor pagination", async () => {
      const { user: target } = await createTestUser();

      // Create 3 followers
      const followers = await Promise.all([
        createTestUser(),
        createTestUser(),
        createTestUser(),
      ]);

      await prisma.follow.createMany({
        data: followers.map((f) => ({
          followerId: f.user.id,
          followingId: target.id,
        })),
      });

      const caller = createTestContext(target.id);

      // Get first page
      const page1 = await caller.social.getFollowers({
        userId: target.id,
        limit: 2,
      });

      expect(page1.items.length).toBe(2);
      expect(page1.nextCursor).toBeDefined();

      // Get second page
      const page2 = await caller.social.getFollowers({
        userId: target.id,
        limit: 2,
        cursor: page1.nextCursor!,
      });

      expect(page2.items.length).toBe(1);
      expect(page2.nextCursor).toBeNull();
    });
  });

  describe("getFollowing", () => {
    it("returns paginated list of users being followed", async () => {
      const { user: follower } = await createTestUser();
      const { user: following1 } = await createTestUser();
      const { user: following2 } = await createTestUser();

      // Create follow relationships
      await prisma.follow.createMany({
        data: [
          { followerId: follower.id, followingId: following1.id },
          { followerId: follower.id, followingId: following2.id },
        ],
      });

      const caller = createTestContext(follower.id);

      const result = await caller.social.getFollowing({
        userId: follower.id,
        limit: 20,
      });

      expect(result.items.length).toBe(2);
      expect(result.items.map((u) => u.id)).toContain(following1.id);
      expect(result.items.map((u) => u.id)).toContain(following2.id);
    });
  });

  describe("getSuggestions", () => {
    it("returns users not currently followed", async () => {
      const { user } = await createTestUser();
      const { user: other1 } = await createTestUser();
      const { user: other2 } = await createTestUser();

      // Follow other1
      await prisma.follow.create({
        data: {
          followerId: user.id,
          followingId: other1.id,
        },
      });

      const caller = createTestContext(user.id);

      const result = await caller.social.getSuggestions({ limit: 20 });

      // Should not include self or already-followed user
      expect(result.items.map((u) => u.id)).not.toContain(user.id);
      expect(result.items.map((u) => u.id)).not.toContain(other1.id);

      // Should include other2
      expect(result.items.map((u) => u.id)).toContain(other2.id);
    });
  });
});
