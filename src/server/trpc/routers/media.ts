import { env } from "@/env";
import { ALLOWED_MIME_TYPES, MAX_MEDIA_PER_TWEET } from "@/lib/constants";
import { createId } from "@paralleldrive/cuid2";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getPublicUrl, getUploadUrl } from "../../s3";
import { createTRPCRouter, protectedProcedure } from "../index";

/**
 * Media router
 *
 * Handles pre-signed S3 upload URLs for direct client-to-S3 uploads.
 * Provides URL validation to ensure media URLs belong to the correct user.
 */

const purposeEnum = z.enum(["tweet", "avatar", "banner"]);

/**
 * getUploadUrl — Generate pre-signed S3 PUT URL for client upload
 *
 * Returns both the upload URL (for PUT request) and the final public URL
 * that should be stored in the database after upload completes.
 */
export const mediaRouter = createTRPCRouter({
  getUploadUrl: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1),
        contentType: z.string(),
        purpose: purposeEnum,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { filename, contentType, purpose } = input;

      // Validate content type
      if (!ALLOWED_MIME_TYPES.includes(contentType as (typeof ALLOWED_MIME_TYPES)[number])) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Supported formats: JPEG, PNG, GIF, WebP",
        });
      }

      // Extract file extension from filename or content type
      const ext = extractExtension(filename, contentType);

      // Generate S3 key: {purpose}/{userId}/{cuid}.{ext}
      const fileId = createId();
      const key = `${purpose}/${userId}/${fileId}.${ext}`;

      // Generate pre-signed PUT URL with 10 minute expiry and 5MB size limit
      const uploadUrl = await getUploadUrl(key, contentType);

      // Generate public URL for the uploaded file
      const publicUrl = getPublicUrl(key);

      return {
        uploadUrl,
        publicUrl,
      };
    }),
});

/**
 * Extract file extension from filename or content type.
 * Falls back to content type mapping if filename has no extension.
 */
function extractExtension(filename: string, contentType: string): string {
  // Try filename extension first
  const match = filename.match(/\.([^.]+)$/);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }

  // Fallback to content type mapping
  const typeMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };

  return typeMap[contentType] || "jpg";
}

/**
 * Validate media URLs belong to the specified user and are from our S3 bucket.
 *
 * Used by tweet.create to ensure uploaded media URLs are legitimate and
 * belong to the user creating the tweet.
 *
 * @param urls - Array of media URLs to validate (max 4)
 * @param userId - User ID that should own the media
 * @param purpose - Expected purpose prefix (e.g., 'tweet')
 * @throws TRPCError if validation fails
 */
export function validateMediaUrls(
  urls: string[],
  userId: string,
  purpose: "tweet" | "avatar" | "banner" = "tweet"
): void {
  // Enforce max 4 images
  if (urls.length > MAX_MEDIA_PER_TWEET) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Maximum 4 images per tweet",
    });
  }

  const s3PublicUrl = env.S3_PUBLIC_URL;

  for (const url of urls) {
    // Verify URL is from our S3 bucket
    if (!url.startsWith(s3PublicUrl)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid media URL: must be from authorized storage",
      });
    }

    // Extract the S3 key (everything after the public URL base)
    const key = url.replace(`${s3PublicUrl}/`, "");

    // Expected prefix: {purpose}/{userId}/
    const expectedPrefix = `${purpose}/${userId}/`;

    if (!key.startsWith(expectedPrefix)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid media URL: does not match user ownership",
      });
    }
  }
}
