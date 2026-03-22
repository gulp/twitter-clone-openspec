/**
 * Integration tests for media router
 *
 * Tests pre-signed URL generation and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env } from "@/env";
import { cleanupDatabase, createTestContext, createTestUser } from "./helpers";

describe("media router", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("getUploadUrl", () => {
    it("returns valid pre-signed URL", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      const result = await caller.media.getUploadUrl({
        filename: "avatar.jpg",
        contentType: "image/jpeg",
        purpose: "avatar",
      });

      expect(result.uploadUrl).toBeDefined();
      expect(result.publicUrl).toBeDefined();

      // Verify upload URL is from S3
      expect(result.uploadUrl).toContain(env.S3_ENDPOINT || env.S3_PUBLIC_URL);

      // Verify public URL is correct format
      expect(result.publicUrl).toContain(env.S3_PUBLIC_URL);
    });

    it("rejects invalid content type", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      await expect(
        caller.media.getUploadUrl({
          filename: "malware.exe",
          contentType: "application/exe",
          purpose: "avatar",
        })
      ).rejects.toThrow();
    });

    it("generates different URLs for different types", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      const avatar = await caller.media.getUploadUrl({
        filename: "avatar.jpg",
        contentType: "image/jpeg",
        purpose: "avatar",
      });

      const banner = await caller.media.getUploadUrl({
        filename: "banner.jpg",
        contentType: "image/jpeg",
        purpose: "banner",
      });

      const tweet = await caller.media.getUploadUrl({
        filename: "tweet.jpg",
        contentType: "image/jpeg",
        purpose: "tweet",
      });

      // URLs should be different
      expect(avatar.publicUrl).not.toBe(banner.publicUrl);
      expect(avatar.publicUrl).not.toBe(tweet.publicUrl);
      expect(banner.publicUrl).not.toBe(tweet.publicUrl);

      // URLs should contain correct path segments
      expect(avatar.publicUrl).toContain("avatars");
      expect(banner.publicUrl).toContain("banners");
      expect(tweet.publicUrl).toContain("tweets");
    });
  });

  describe("URL validation on tweet create", () => {
    it("accepts valid media URLs from S3 bucket", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      // Get upload URL first
      const media = await caller.media.getUploadUrl({
        filename: "photo.jpg",
        contentType: "image/jpeg",
        purpose: "tweet",
      });

      // Use that URL in tweet create
      const tweet = await caller.tweet.create({
        content: "Tweet with media",
        mediaUrls: [media.publicUrl],
      });

      expect(tweet.id).toBeDefined();
      expect(tweet.mediaUrls).toContain(media.publicUrl);
    });

    it("rejects media URLs not from S3 bucket", async () => {
      const { user } = await createTestUser();
      const caller = createTestContext(user.id);

      await expect(
        caller.tweet.create({
          content: "Tweet with evil media",
          mediaUrls: ["https://evil.com/malware.jpg"],
        })
      ).rejects.toThrow();
    });
  });
});
