import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";

/**
 * S3 client singleton.
 * Configured for MinIO in development (forcePathStyle) and AWS S3 in production.
 */
export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  forcePathStyle: env.NODE_ENV === "development", // Required for MinIO
});

/**
 * Generate a pre-signed PUT URL for client-side uploads.
 * URL expires in 10 minutes.
 *
 * @param key - S3 object key (file path within bucket)
 * @param contentType - MIME type (e.g., "image/jpeg")
 * @returns Pre-signed URL for PUT upload
 */
export async function getUploadUrl(
  key: string,
  contentType: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const signedUrl = await getSignedUrl(s3, command, {
    expiresIn: 600, // 10 minutes
  });

  return signedUrl;
}

/**
 * Generate the public URL for an uploaded object.
 * Uses S3_PUBLIC_URL from env (CDN or direct S3 bucket URL).
 *
 * @param key - S3 object key
 * @returns Public URL for the uploaded object
 */
export function getPublicUrl(key: string): string {
  return `${env.S3_PUBLIC_URL}/${key}`;
}
