import { PrismaClient } from "@prisma/client";
import { env } from "@/env";

/**
 * Prisma client singleton.
 *
 * In development, we store the client in a global variable to prevent
 * hot-reload connection exhaustion. In production, we instantiate fresh.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * publicUserSelect
 *
 * CRITICAL INVARIANT I1: NEVER expose email, hashedPassword, or sessionVersion
 * in public user responses.
 *
 * Use this select for any user data returned to clients who are NOT
 * the user themselves (profile pages, author info on tweets, etc.).
 */
export const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  bannerUrl: true,
  createdAt: true,
  followerCount: true,
  followingCount: true,
  tweetCount: true,
} as const;

/**
 * selfUserSelect
 *
 * CRITICAL INVARIANT I2: Include email ONLY for the authenticated user
 * viewing their own profile. NEVER include hashedPassword or sessionVersion.
 *
 * Use this select when returning the current user's own profile data.
 */
export const selfUserSelect = {
  ...publicUserSelect,
  email: true,
} as const;
