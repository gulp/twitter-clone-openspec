import { env } from "@/env";
import { log } from "@/lib/logger";
import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * AsyncLocalStorage for request context propagation.
 * Stores requestId for correlation with Prisma queries.
 */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/**
 * Prisma client singleton.
 *
 * In development, we store the client in a global variable to prevent
 * hot-reload connection exhaustion. In production, we instantiate fresh.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = basePrisma;
}

/**
 * Extended Prisma client with query logging middleware.
 *
 * Per §1.19: Tags all queries with requestId from AsyncLocalStorage,
 * enabling correlation of slow-query WARN logs to originating HTTP requests.
 */
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const startMs = Date.now();
        const ctx = requestContext.getStore();

        try {
          const result = await query(args);
          const latencyMs = Date.now() - startMs;

          // Log slow queries (>500ms) at WARN level
          if (latencyMs > 500) {
            log.warn("Slow Prisma query", {
              requestId: ctx?.requestId,
              model,
              operation,
              latencyMs,
            });
          }

          return result;
        } catch (error) {
          const latencyMs = Date.now() - startMs;

          // Log query errors
          log.error("Prisma query error", {
            requestId: ctx?.requestId,
            model,
            operation,
            latencyMs,
            error: error instanceof Error ? error.message : String(error),
          });

          throw error;
        }
      },
    },
  },
});

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

/**
 * basePrismaForAdapter
 *
 * NextAuth PrismaAdapter requires the raw PrismaClient without extensions.
 * Export basePrisma for use in NextAuth adapter.
 */
export { basePrisma };
