import { env } from "@/env";
import { log } from "@/lib/logger";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * S3 client singleton.
 * Configured for MinIO in development (forcePathStyle) and AWS S3 in production.
 *
 * In development, we store the client in a global variable to prevent
 * hot-reload connection exhaustion. In production, we instantiate fresh.
 */
const globalForS3 = globalThis as unknown as {
  s3: S3Client | undefined;
};

export const s3 =
  globalForS3.s3 ??
  new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: env.NODE_ENV !== "production", // Required for MinIO (dev + test)
  });

if (env.NODE_ENV !== "production") {
  globalForS3.s3 = s3;
}

/**
 * Generate a pre-signed PUT URL for client-side uploads.
 * URL expires in 10 minutes.
 *
 * NOTE: 5MB size limit must be enforced by:
 * 1. Client-side validation before upload
 * 2. S3 bucket policy (MaximumObjectSize condition)
 * Pre-signed PUT URLs don't support Content-Length restrictions directly.
 *
 * @param key - S3 object key (file path within bucket)
 * @param contentType - MIME type (e.g., "image/jpeg")
 * @returns Pre-signed URL for PUT upload
 */
export async function getUploadUrl(key: string, contentType: string, requestId?: string): Promise<string> {
  try {
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: 600, // 10 minutes
    });

    return signedUrl;
  } catch (error) {
    log.error("Failed to generate S3 pre-signed URL", {
      feature: "media",
      key,
      contentType,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    throw new Error("Failed to generate upload URL");
  }
}

/**
 * Generate the public URL for an uploaded object.
 * Uses S3_PUBLIC_URL from env (CDN or direct S3 bucket URL).
 *
 * @param key - S3 object key
 * @returns Public URL for the uploaded object
 */
export function getPublicUrl(key: string): string {
  // Normalize trailing slashes to prevent double-slash in URL
  const baseUrl = env.S3_PUBLIC_URL.replace(/\/+$/, "");
  return `${baseUrl}/${key}`;
}
