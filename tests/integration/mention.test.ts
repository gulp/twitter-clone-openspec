/**
 * Integration tests for mention resolution
 *
 * Tests @mention parsing, username resolution, and case-insensitivity.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/server/db";
import { resolveMentions } from "@/server/services/mention";
import { cleanupDatabase, createTestUser, createTestContext } from "./helpers";

describe("mention resolution", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("resolveMentions", () => {
    it("resolves usernames case-insensitively", async () => {
      // Create users with mixed-case usernames
      const { user: alice } = await createTestUser({ username: "AliceUser" });
      const { user: bob } = await createTestUser({ username: "BobSmith" });
      const { user: charlie } = await createTestUser({ username: "charlie_99" });

      // Test case-insensitive resolution with various cases
      const userIds = await resolveMentions([
        "aliceuser", // all lowercase
        "BOBSMITH", // all uppercase
        "Charlie_99", // mixed case
      ]);

      expect(userIds).toHaveLength(3);
      expect(userIds).toContain(alice.id);
      expect(userIds).toContain(bob.id);
      expect(userIds).toContain(charlie.id);
    });

    it("returns empty array for non-existent users", async () => {
      const userIds = await resolveMentions(["nonexistent", "fakeuser"]);
      expect(userIds).toEqual([]);
    });

    it("returns only existing users when mix of valid and invalid", async () => {
      const { user: alice } = await createTestUser({ username: "AliceUser" });

      const userIds = await resolveMentions([
        "aliceuser", // exists (case-insensitive)
        "nonexistent", // does not exist
      ]);

      expect(userIds).toHaveLength(1);
      expect(userIds).toContain(alice.id);
    });

    it("handles empty array", async () => {
      const userIds = await resolveMentions([]);
      expect(userIds).toEqual([]);
    });
  });

  describe("end-to-end mention flow", () => {
    it("creates MENTION notification for mixed-case @username", async () => {
      // Create users
      const { user: mentionedUser } = await createTestUser({ username: "AliceUser" });
      const { user: mentionerUser } = await createTestUser({ username: "bob_smith" });

      const caller = createTestContext(mentionerUser.id);

      // Create tweet with lowercase mention of mixed-case username
      const tweet = await caller.tweet.create({
        content: "Hey @aliceuser, check this out! Also @nonexistent.",
        mediaUrls: [],
      });

      expect(tweet.id).toBeDefined();

      // Verify MENTION notification was created for AliceUser (despite lowercase @mention)
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: mentionedUser.id,
          actorId: mentionerUser.id,
          type: "MENTION",
          tweetId: tweet.id,
        },
      });

      expect(notification).toBeTruthy();
      expect(notification?.recipientId).toBe(mentionedUser.id);

      // Verify no notification for @nonexistent
      const allNotifications = await prisma.notification.findMany();
      expect(allNotifications).toHaveLength(1); // Only the AliceUser notification
    });

    it("creates MENTION notification for uppercase @username", async () => {
      const { user: mentionedUser } = await createTestUser({ username: "lowercase_user" });
      const { user: mentionerUser } = await createTestUser({ username: "other_user" });

      const caller = createTestContext(mentionerUser.id);

      // Create tweet with uppercase mention of lowercase username
      const tweet = await caller.tweet.create({
        content: "Hello @LOWERCASE_USER!",
        mediaUrls: [],
      });

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: mentionedUser.id,
          type: "MENTION",
          tweetId: tweet.id,
        },
      });

      expect(notification).toBeTruthy();
    });

    it("creates MENTION notification for exact case @username", async () => {
      const { user: mentionedUser } = await createTestUser({ username: "ExactCase" });
      const { user: mentionerUser } = await createTestUser({ username: "other_user" });

      const caller = createTestContext(mentionerUser.id);

      // Create tweet with exact case match
      const tweet = await caller.tweet.create({
        content: "Hi @ExactCase!",
        mediaUrls: [],
      });

      // Verify notification was created
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: mentionedUser.id,
          type: "MENTION",
          tweetId: tweet.id,
        },
      });

      expect(notification).toBeTruthy();
    });

    it("does not create duplicate notifications for same user mentioned twice", async () => {
      const { user: mentionedUser } = await createTestUser({ username: "AliceUser" });
      const { user: mentionerUser } = await createTestUser({ username: "bob_smith" });

      const caller = createTestContext(mentionerUser.id);

      // Mention same user twice with different cases
      const tweet = await caller.tweet.create({
        content: "Hey @AliceUser, I mean @aliceuser!",
        mediaUrls: [],
      });

      // Verify only one notification was created (deduplication works)
      const notifications = await prisma.notification.findMany({
        where: {
          recipientId: mentionedUser.id,
          type: "MENTION",
          tweetId: tweet.id,
        },
      });

      expect(notifications).toHaveLength(1);
    });
  });
});
