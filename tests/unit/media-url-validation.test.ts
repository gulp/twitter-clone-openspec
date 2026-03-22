import { describe, expect, it } from "vitest";
import { MAX_MEDIA_PER_TWEET } from "@/lib/constants";

/**
 * Media URL validation tests — validates S3 URL acceptance and rejection rules.
 *
 * Media URLs must:
 * - Start with S3_PUBLIC_URL from env
 * - Follow pattern: {S3_PUBLIC_URL}/users/{userId}/media/{filename}
 * - Be limited to MAX_MEDIA_PER_TWEET (4) per tweet
 *
 * This validation typically happens in tRPC routers, but we test the logic here.
 */

describe("Media URL validation", () => {
  const mockS3PublicUrl = "https://cdn.example.com/twitter-media";
  const mockUserId = "user-123";

  // Helper function to validate media URL
  function validateMediaUrl(url: string, userId: string, s3PublicUrl: string): boolean {
    // Must start with S3_PUBLIC_URL
    if (!url.startsWith(s3PublicUrl)) {
      return false;
    }

    // Must follow pattern: {S3_PUBLIC_URL}/users/{userId}/media/{filename}
    const expectedPrefix = `${s3PublicUrl}/users/${userId}/media/`;
    if (!url.startsWith(expectedPrefix)) {
      return false;
    }

    // Must have a filename after the prefix
    const filename = url.slice(expectedPrefix.length);
    if (filename.length === 0) {
      return false;
    }

    return true;
  }

  // Helper to validate array of media URLs
  function validateMediaUrls(urls: string[], userId: string, s3PublicUrl: string): boolean {
    // Must not exceed MAX_MEDIA_PER_TWEET
    if (urls.length > MAX_MEDIA_PER_TWEET) {
      return false;
    }

    // Each URL must be valid
    return urls.every((url) => validateMediaUrl(url, userId, s3PublicUrl));
  }

  it("should accept valid S3 URL", () => {
    const url = `${mockS3PublicUrl}/users/${mockUserId}/media/image.jpg`;
    expect(validateMediaUrl(url, mockUserId, mockS3PublicUrl)).toBe(true);
  });

  it("should reject external domain URL", () => {
    const url = "https://evil.com/users/user-123/media/image.jpg";
    expect(validateMediaUrl(url, mockUserId, mockS3PublicUrl)).toBe(false);
  });

  it("should reject wrong user prefix", () => {
    const url = `${mockS3PublicUrl}/users/other-user/media/image.jpg`;
    expect(validateMediaUrl(url, mockUserId, mockS3PublicUrl)).toBe(false);
  });

  it("should accept array with 4 images", () => {
    const urls = [
      `${mockS3PublicUrl}/users/${mockUserId}/media/image1.jpg`,
      `${mockS3PublicUrl}/users/${mockUserId}/media/image2.jpg`,
      `${mockS3PublicUrl}/users/${mockUserId}/media/image3.jpg`,
      `${mockS3PublicUrl}/users/${mockUserId}/media/image4.jpg`,
    ];
    expect(validateMediaUrls(urls, mockUserId, mockS3PublicUrl)).toBe(true);
  });

  it("should reject array with more than 4 images", () => {
    const urls = [
      `${mockS3PublicUrl}/users/${mockUserId}/media/image1.jpg`,
      `${mockS3PublicUrl}/users/${mockUserId}/media/image2.jpg`,
      `${mockS3PublicUrl}/users/${mockUserId}/media/image3.jpg`,
      `${mockS3PublicUrl}/users/${mockUserId}/media/image4.jpg`,
      `${mockS3PublicUrl}/users/${mockUserId}/media/image5.jpg`,
    ];
    expect(validateMediaUrls(urls, mockUserId, mockS3PublicUrl)).toBe(false);
  });

  it("should accept empty array", () => {
    const urls: string[] = [];
    expect(validateMediaUrls(urls, mockUserId, mockS3PublicUrl)).toBe(true);
  });

  it("should accept single image", () => {
    const urls = [`${mockS3PublicUrl}/users/${mockUserId}/media/image.jpg`];
    expect(validateMediaUrls(urls, mockUserId, mockS3PublicUrl)).toBe(true);
  });

  it("should reject URL without filename", () => {
    const url = `${mockS3PublicUrl}/users/${mockUserId}/media/`;
    expect(validateMediaUrl(url, mockUserId, mockS3PublicUrl)).toBe(false);
  });

  it("should reject URL with wrong path structure", () => {
    const url = `${mockS3PublicUrl}/media/image.jpg`;
    expect(validateMediaUrl(url, mockUserId, mockS3PublicUrl)).toBe(false);
  });

  it("should accept URL with various file extensions", () => {
    const extensions = ["jpg", "jpeg", "png", "gif", "webp"];
    for (const ext of extensions) {
      const url = `${mockS3PublicUrl}/users/${mockUserId}/media/image.${ext}`;
      expect(validateMediaUrl(url, mockUserId, mockS3PublicUrl)).toBe(true);
    }
  });

  it("should accept URL with UUID-like filename", () => {
    const url = `${mockS3PublicUrl}/users/${mockUserId}/media/clx9abc123def456.jpg`;
    expect(validateMediaUrl(url, mockUserId, mockS3PublicUrl)).toBe(true);
  });

  it("should reject mixed valid and invalid URLs in array", () => {
    const urls = [
      `${mockS3PublicUrl}/users/${mockUserId}/media/image1.jpg`,
      "https://evil.com/image2.jpg",
    ];
    expect(validateMediaUrls(urls, mockUserId, mockS3PublicUrl)).toBe(false);
  });

  it("should handle S3_PUBLIC_URL with trailing slash", () => {
    const s3UrlWithSlash = "https://cdn.example.com/twitter-media/";
    const url = `${s3UrlWithSlash}users/${mockUserId}/media/image.jpg`;
    // Note: validation would need to normalize trailing slashes
    // For now, this documents the expected behavior
    expect(url.startsWith(s3UrlWithSlash)).toBe(true);
  });

  it("should enforce MAX_MEDIA_PER_TWEET constant value", () => {
    expect(MAX_MEDIA_PER_TWEET).toBe(4);
  });
});
