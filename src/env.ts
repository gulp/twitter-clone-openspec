import { z } from "zod";

/**
 * Environment variable validation schema.
 * This file is imported at process start to validate all required environment variables.
 * If validation fails, the process exits immediately with a clear error message.
 */

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Redis
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // NextAuth
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL"),
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),

  // S3/MinIO
  S3_ENDPOINT: z.string().min(1, "S3_ENDPOINT is required"),
  S3_REGION: z.string().min(1, "S3_REGION is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_ACCESS_KEY: z.string().min(1, "S3_ACCESS_KEY is required"),
  S3_SECRET_KEY: z.string().min(1, "S3_SECRET_KEY is required"),
  S3_PUBLIC_URL: z.string().min(1, "S3_PUBLIC_URL is required"),

  // App
  APP_ORIGIN: z.string().url("APP_ORIGIN must be a valid URL"),

  // Optional: OAuth - Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Optional: OAuth - GitHub
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Optional: SMTP/Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Optional: Preview Origins
  ALLOWED_PREVIEW_ORIGINS: z.string().optional(),

  // Node environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

/**
 * Validate and parse environment variables.
 * Throws with detailed error message if validation fails.
 */
function validateEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `  - ${path}: ${issue.message}`;
    });

    console.error("\n❌ Environment validation failed:\n");
    console.error(errors.join("\n"));
    console.error("\nPlease check your .env file and ensure all required variables are set.");
    console.error("See .env.example for reference.\n");

    process.exit(1);
  }

  return parsed.data;
}

/**
 * Memoized validated environment variables.
 * Validation runs lazily on first access, not at import time.
 */
let validatedEnv: z.infer<typeof envSchema> | null = null;

function getValidatedEnv(): z.infer<typeof envSchema> {
  if (validatedEnv === null) {
    validatedEnv = validateEnv();
  }
  return validatedEnv;
}

/**
 * Validated and typed environment variables.
 * Import this object throughout the application instead of accessing process.env directly.
 *
 * Uses a Proxy to defer validation until first property access.
 * This allows builds and type-checking to succeed without a full .env file.
 */
export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop) {
    const validated = getValidatedEnv();
    return validated[prop as keyof typeof validated];
  },
});

/**
 * Type-only export for cases where you need the type without triggering validation.
 */
export type Env = z.infer<typeof envSchema>;
