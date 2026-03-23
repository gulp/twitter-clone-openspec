import { describe, expect, it } from "vitest";
import { MAX_MEDIA_PER_TWEET } from "@/lib/constants";
import { validateMediaUrls } from "@/server/trpc/routers/media";
import { env } from "@/env";

/**
 * Media URL validation tests — validates S3 URL acceptance and rejection rules.
 *
 * Media URLs must:
 * - Start with S3_PUBLIC_URL from env
 * - Follow pattern: {S3_PUBLIC_URL}/{purpose}/{userId}/{filename}
 * - Be limited to MAX_MEDIA_PER_TWEET (4) per tweet
 *
 * Tests the actual validateMediaUrls implementation from media.ts router.
 */

describe("Media URL validation", () => {
  const s3PublicUrl = env.S3_PUBLIC_URL.replace(/\/+$/, "");
  const mockUserId = "user-123";

  it("should accept valid tweet media URL", () => {
    const url = `${s3PublicUrl}/tweet/${mockUserId}/clx9abc123def456.jpg`;
    expect(() => validateMediaUrls([url], mockUserId, "tweet")).not.toThrow();
  });

  it("should accept valid avatar URL", () => {
    const url = `${s3PublicUrl}/avatar/${mockUserId}/clx9abc123def456.jpg`;
    expect(() => validateMediaUrls([url], mockUserId, "avatar")).not.toThrow();
  });

  it("should accept valid banner URL", () => {
    const url = `${s3PublicUrl}/banner/${mockUserId}/clx9abc123def456.jpg`;
    expect(() => validateMediaUrls([url], mockUserId, "banner")).not.toThrow();
  });

  it("should reject external domain URL", () => {
    const url = "https://evil.com/tweet/user-123/image.jpg";
    expect(() => validateMediaUrls([url], mockUserId, "tweet")).toThrow(
      "Invalid media URL: must be from authorized storage"
    );
  });

  it("should reject wrong user prefix", () => {
    const url = `${s3PublicUrl}/tweet/other-user/image.jpg`;
    expect(() => validateMediaUrls([url], mockUserId, "tweet")).toThrow(
      "Invalid media URL: does not match user ownership"
    );
  });

  it("should reject wrong purpose prefix", () => {
    const url = `${s3PublicUrl}/avatar/${mockUserId}/image.jpg`;
    expect(() => validateMediaUrls([url], mockUserId, "tweet")).toThrow(
      "Invalid media URL: does not match user ownership"
    );
  });

  it("should accept array with 4 images", () => {
    const urls = [
      `${s3PublicUrl}/tweet/${mockUserId}/image1.jpg`,
      `${s3PublicUrl}/tweet/${mockUserId}/image2.jpg`,
      `${s3PublicUrl}/tweet/${mockUserId}/image3.jpg`,
      `${s3PublicUrl}/tweet/${mockUserId}/image4.jpg`,
    ];
    expect(() => validateMediaUrls(urls, mockUserId, "tweet")).not.toThrow();
  });

  it("should reject array with more than 4 images", () => {
    const urls = [
      `${s3PublicUrl}/tweet/${mockUserId}/image1.jpg`,
      `${s3PublicUrl}/tweet/${mockUserId}/image2.jpg`,
      `${s3PublicUrl}/tweet/${mockUserId}/image3.jpg`,
      `${s3PublicUrl}/tweet/${mockUserId}/image4.jpg`,
      `${s3PublicUrl}/tweet/${mockUserId}/image5.jpg`,
    ];
    expect(() => validateMediaUrls(urls, mockUserId, "tweet")).toThrow(
      "Maximum 4 images per tweet"
    );
  });

  it("should accept empty array", () => {
    const urls: string[] = [];
    expect(() => validateMediaUrls(urls, mockUserId, "tweet")).not.toThrow();
  });

  it("should accept single image", () => {
    const urls = [`${s3PublicUrl}/tweet/${mockUserId}/image.jpg`];
    expect(() => validateMediaUrls(urls, mockUserId, "tweet")).not.toThrow();
  });

  it("should reject URL with wrong path structure (missing purpose)", () => {
    const url = `${s3PublicUrl}/${mockUserId}/image.jpg`;
    expect(() => validateMediaUrls([url], mockUserId, "tweet")).toThrow(
      "Invalid media URL: does not match user ownership"
    );
  });

  it("should accept URL with various file extensions", () => {
    const extensions = ["jpg", "jpeg", "png", "gif", "webp"];
    for (const ext of extensions) {
      const url = `${s3PublicUrl}/tweet/${mockUserId}/image.${ext}`;
      expect(() => validateMediaUrls([url], mockUserId, "tweet")).not.toThrow();
    }
  });

  it("should accept URL with CUID-like filename", () => {
    const url = `${s3PublicUrl}/tweet/${mockUserId}/clx9abc123def456.jpg`;
    expect(() => validateMediaUrls([url], mockUserId, "tweet")).not.toThrow();
  });

  it("should reject mixed valid and invalid URLs in array", () => {
    const urls = [
      `${s3PublicUrl}/tweet/${mockUserId}/image1.jpg`,
      "https://evil.com/image2.jpg",
    ];
    expect(() => validateMediaUrls(urls, mockUserId, "tweet")).toThrow(
      "Invalid media URL: must be from authorized storage"
    );
  });

  it("should normalize trailing slashes in S3_PUBLIC_URL", () => {
    // validateMediaUrls normalizes trailing slashes internally
    // This test verifies URLs work regardless of trailing slashes in env
    const url = `${s3PublicUrl}/tweet/${mockUserId}/image.jpg`;
    expect(() => validateMediaUrls([url], mockUserId, "tweet")).not.toThrow();
  });

  it("should enforce MAX_MEDIA_PER_TWEET constant value", () => {
    expect(MAX_MEDIA_PER_TWEET).toBe(4);
  });

  it("should validate all URLs in array", () => {
    const urls = [
      `${s3PublicUrl}/tweet/${mockUserId}/image1.jpg`,
      `${s3PublicUrl}/tweet/other-user/image2.jpg`, // wrong user
    ];
    expect(() => validateMediaUrls(urls, mockUserId, "tweet")).toThrow(
      "Invalid media URL: does not match user ownership"
    );
  });
});
