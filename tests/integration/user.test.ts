/**
 * Integration tests for user router
 *
 * Tests user profile retrieval and updates.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "@/env";
import { prisma } from "@/server/db";
import { cleanupDatabase, createTestContext, createTestUser } from "./helpers";

describe("user router", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("getByUsername", () => {
    it("returns profile with publicUserSelect only", async () => {
      const { user } = await createTestUser({
        username: "testuser",
        displayName: "Test User",
        bio: "Test bio",
      });

      const caller = createTestContext();

      const result = await caller.user.getByUsername({
        username: "testuser",
      });

      // Should have all public fields
      expect(result.id).toBe(user.id);
      expect(result.username).toBe("testuser");
      expect(result.displayName).toBe("Test User");
      expect(result.bio).toBe("Test bio");
      expect(result.createdAt).toBeDefined();

      // Should NOT have email (public select)
      expect("email" in result).toBe(false);
      expect("hashedPassword" in result).toBe(false);
      expect("sessionVersion" in result).toBe(false);
    });

    it("returns 404 for non-existent username", async () => {
      const caller = createTestContext();

      await expect(
        caller.user.getByUsername({ username: "nonexistent" })
      ).rejects.toThrow("User not found");
    });

    it("includes isFollowing for authenticated users", async () => {
      const { user: viewer } = await createTestUser();
      const { user: target } = await createTestUser({ username: "target" });

      // Create follow relationship
      await prisma.follow.create({
        data: {
          followerId: viewer.id,
          followingId: target.id,
        },
      });

      const caller = createTestContext(viewer.id);

      const result = await caller.user.getByUsername({
        username: "target",
      });

      expect(result.isFollowing).toBe(true);
    });
  });

  describe("updateProfile", () => {
    it("updates displayName and bio", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      const result = await caller.user.updateProfile({
        displayName: "New Display Name",
        bio: "New bio text",
      });

      expect(result.displayName).toBe("New Display Name");
      expect(result.bio).toBe("New bio text");

      // Verify in DB
      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(updatedUser!.displayName).toBe("New Display Name");
      expect(updatedUser!.bio).toBe("New bio text");
    });

    it("validates avatar/banner URLs against S3 bucket origin", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      const s3PublicUrl = env.S3_PUBLIC_URL;
      const validAvatarUrl = `${s3PublicUrl}/avatar/${user.id}/photo.jpg`;

      const result = await caller.user.updateProfile({
        avatarUrl: validAvatarUrl,
      });

      expect(result.avatarUrl).toBe(validAvatarUrl);

      // Try invalid URL (should fail)
      await expect(
        caller.user.updateProfile({
          avatarUrl: "https://evil.com/photo.jpg",
        })
      ).rejects.toThrow();
    });

    it("returns selfUserSelect for self-scoped mutation results", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      const result = await caller.user.updateProfile({
        bio: "Updated bio",
      });

      // Should include email (self select)
      expect(result.email).toBeDefined();
      expect(result.email).toBe(user.email);

      // Should still exclude sensitive fields
      expect("hashedPassword" in result).toBe(false);
      expect("sessionVersion" in result).toBe(false);
    });
  });
});
