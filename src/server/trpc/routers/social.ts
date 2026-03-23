import { log } from "@/lib/logger";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, publicUserSelect } from "../../db";
import { cacheDel, cacheGet, cacheIncr, cacheSet } from "../../redis";
import { createNotification } from "../../services/notification";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../index";

/**
 * Social graph router
 *
 * Procedures:
 * - follow: create follow relationship with atomic count updates
 * - unfollow: remove follow relationship (idempotent)
 * - getFollowers: paginated list of followers for a user
 * - getFollowing: paginated list of users a user follows
 * - getSuggestions: mutual-connection-based follow suggestions (cached)
 */
export const socialRouter = createTRPCRouter({
  /**
   * follow — Follow another user
   *
   * - Blocks self-follow (I6)
   * - Creates Follow relationship with atomic count increments
   * - Fires FOLLOW notification
   * - Bumps feed version and invalidates suggestion cache
   * - Idempotent: if already following, succeeds silently
   */
  follow: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const followerId = ctx.session.user.id;
      const { userId: followingId } = input;

      // Self-follow check (I6)
      if (followerId === followingId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot follow yourself",
        });
      }

      // Check if already following (idempotent)
      const existingFollow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId,
            followingId,
          },
        },
      });

      if (existingFollow) {
        // Already following, return success idempotently
        return { success: true };
      }

      // Transaction: create Follow + increment counts (I3)
      // Catch P2002 (unique constraint) for concurrent follow race condition
      try {
        await prisma.$transaction([
          prisma.follow.create({
            data: {
              followerId,
              followingId,
            },
          }),
          prisma.user.update({
            where: { id: followerId },
            data: { followingCount: { increment: 1 } },
          }),
          prisma.user.update({
            where: { id: followingId },
            data: { followerCount: { increment: 1 } },
          }),
        ]);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          return { success: true }; // Already followed (concurrent request)
        }

        // Log unexpected errors before re-throwing
        log.error("Failed to follow user", {
          followerId,
          followingId,
          error: error instanceof Error ? error.message : String(error),
          requestId: ctx.requestId,
        });
        throw error;
      }

      // Fire FOLLOW notification (self-suppression handled in createNotification)
      // Best-effort: fail-open (§4, §10)
      try {
        await createNotification(
          {
            recipientId: followingId,
            actorId: followerId,
            type: "FOLLOW",
          },
          ctx.requestId
        );
      } catch (error) {
        log.warn("Failed to create FOLLOW notification (fail open)", {
          followerId,
          followingId,
          error: error instanceof Error ? error.message : String(error),
          requestId: ctx.requestId,
        });
      }

      // Bump feed version for follower (invalidates cached home timeline)
      await bumpFeedVersion(followerId);

      // Invalidate suggestion caches for both users
      await Promise.all([
        cacheDel(`suggestions:${followerId}`),
        cacheDel(`suggestions:${followingId}`),
      ]);

      return { success: true };
    }),

  /**
   * unfollow — Unfollow a user
   *
   * - Removes Follow relationship with atomic count decrements
   * - Idempotent: if not following, succeeds silently (no error)
   * - Bumps feed version and invalidates suggestion cache
   */
  unfollow: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const followerId = ctx.session.user.id;
      const { userId: followingId } = input;

      // Check if currently following
      const existingFollow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId,
            followingId,
          },
        },
      });

      if (!existingFollow) {
        // Not following, return success idempotently
        return { success: true };
      }

      // Transaction: delete Follow + decrement counts (I3)
      try {
        await prisma.$transaction([
          prisma.follow.delete({
            where: {
              followerId_followingId: {
                followerId,
                followingId,
              },
            },
          }),
          prisma.user.update({
            where: { id: followerId },
            data: { followingCount: { decrement: 1 } },
          }),
          prisma.user.update({
            where: { id: followingId },
            data: { followerCount: { decrement: 1 } },
          }),
        ]);
      } catch (error) {
        // P2025: record not found (concurrent unfollow won the race)
        if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
          return { success: true };
        }

        // Log unexpected errors before re-throwing
        log.error("Failed to unfollow user", {
          followerId,
          followingId,
          error: error instanceof Error ? error.message : String(error),
          requestId: ctx.requestId,
        });
        throw error;
      }

      // Bump feed version for follower (invalidates cached home timeline)
      await bumpFeedVersion(followerId);

      // Invalidate suggestion caches for both users
      await Promise.all([
        cacheDel(`suggestions:${followerId}`),
        cacheDel(`suggestions:${followingId}`),
      ]);

      return { success: true };
    }),

  /**
   * getFollowers — Get list of users who follow a given user
   *
   * Returns paginated follower profiles with cursor-based pagination.
   * Ordered by Follow.createdAt DESC (most recent followers first).
   * Includes isFollowing state for authenticated users (§1.16).
   */
  getFollowers: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { userId, cursor, limit } = input;

      const follows = await prisma.follow.findMany({
        where: { followingId: userId },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        cursor: cursor
          ? (() => {
              const [followerId, followingId] = cursor.split(":");
              if (!followerId || !followingId) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Invalid cursor",
                });
              }
              return {
                followerId_followingId: { followerId, followingId },
              };
            })()
          : undefined,
        include: {
          follower: { select: publicUserSelect },
        },
      });

      let nextCursor: string | null = null;
      if (follows.length > limit) {
        const nextItem = follows.pop();
        nextCursor = nextItem ? `${nextItem.followerId}:${nextItem.followingId}` : null;
      }

      const users = follows.map((f) => f.follower);

      // If authenticated: batch-check isFollowing (§1.16)
      let isFollowingSet = new Set<string>();

      if (ctx.session?.user?.id) {
        const currentUserId = ctx.session.user.id;
        const userIds = users.map((u) => u.id);

        if (userIds.length > 0) {
          const following = await prisma.follow.findMany({
            where: { followerId: currentUserId, followingId: { in: userIds } },
            select: { followingId: true },
          });

          isFollowingSet = new Set(following.map((f) => f.followingId));
        }
      }

      // Annotate users with isFollowing state
      const items = users.map((user) => ({
        ...user,
        isFollowing: isFollowingSet.has(user.id),
      }));

      return {
        items,
        nextCursor,
      };
    }),

  /**
   * getFollowing — Get list of users a given user follows
   *
   * Returns paginated profiles with cursor-based pagination.
   * Ordered by Follow.createdAt DESC (most recent follows first).
   * Includes isFollowing state for authenticated users (§1.16).
   */
  getFollowing: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { userId, cursor, limit } = input;

      const follows = await prisma.follow.findMany({
        where: { followerId: userId },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        cursor: cursor
          ? (() => {
              const [followerId, followingId] = cursor.split(":");
              if (!followerId || !followingId) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Invalid cursor",
                });
              }
              return {
                followerId_followingId: { followerId, followingId },
              };
            })()
          : undefined,
        include: {
          following: { select: publicUserSelect },
        },
      });

      let nextCursor: string | null = null;
      if (follows.length > limit) {
        const nextItem = follows.pop();
        nextCursor = nextItem ? `${nextItem.followerId}:${nextItem.followingId}` : null;
      }

      const users = follows.map((f) => f.following);

      // If authenticated: batch-check isFollowing (§1.16)
      let isFollowingSet = new Set<string>();

      if (ctx.session?.user?.id) {
        const currentUserId = ctx.session.user.id;
        const userIds = users.map((u) => u.id);

        if (userIds.length > 0) {
          const following = await prisma.follow.findMany({
            where: { followerId: currentUserId, followingId: { in: userIds } },
            select: { followingId: true },
          });

          isFollowingSet = new Set(following.map((f) => f.followingId));
        }
      }

      // Annotate users with isFollowing state
      const items = users.map((user) => ({
        ...user,
        isFollowing: isFollowingSet.has(user.id),
      }));

      return {
        items,
        nextCursor,
      };
    }),

  /**
   * getSuggestions — Get follow suggestions based on mutual connections
   *
   * Returns up to 10 suggested users, excluding already-followed users.
   * Ordered by number of mutual connections (users followed by people you follow).
   *
   * Results cached in Redis with 5 min TTL.
   * Cache invalidated on follow/unfollow.
   */
  getSuggestions: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const cacheKey = `suggestions:${userId}`;

    // Try cache first
    const cached = await cacheGet(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid JSON, continue to DB query
      }
    }

    // Raw SQL query for mutual connections
    // Find users followed by people the current user follows,
    // excluding users already followed and the current user themselves
    const suggestions = await prisma.$queryRaw<
      Array<{
        id: string;
        username: string;
        displayName: string;
        bio: string;
        avatarUrl: string;
        bannerUrl: string;
        createdAt: Date;
        followerCount: number;
        followingCount: number;
        tweetCount: number;
        mutualCount: number;
      }>
    >`
      WITH followed AS (
        SELECT "followingId" FROM "Follow" WHERE "followerId" = ${userId}
      ),
      mutual AS (
        SELECT f."followingId" AS "suggestedUserId", COUNT(*) AS "mutualCount"
        FROM "Follow" f
        WHERE f."followerId" IN (SELECT "followingId" FROM followed)
          AND f."followingId" != ${userId}
          AND f."followingId" NOT IN (SELECT "followingId" FROM followed)
        GROUP BY f."followingId"
      )
      SELECT
        u.id,
        u.username,
        u."displayName",
        u.bio,
        u."avatarUrl",
        u."bannerUrl",
        u."createdAt",
        u."followerCount",
        u."followingCount",
        u."tweetCount",
        m."mutualCount"::int AS "mutualCount"
      FROM mutual m
      JOIN "User" u ON u.id = m."suggestedUserId"
      ORDER BY m."mutualCount" DESC, u."followerCount" DESC
      LIMIT 10
    `;

    // Batch-check isFollowing (§1.16)
    let isFollowingSet = new Set<string>();
    const userIds = suggestions.map((s) => s.id);

    if (userIds.length > 0) {
      const following = await prisma.follow.findMany({
        where: { followerId: userId, followingId: { in: userIds } },
        select: { followingId: true },
      });

      isFollowingSet = new Set(following.map((f) => f.followingId));
    }

    // Map to publicUserSelect shape (exclude mutualCount, add isFollowing)
    const result = suggestions.map(({ mutualCount, ...user }) => ({
      ...user,
      isFollowing: isFollowingSet.has(user.id),
    }));

    // Cache for 5 minutes
    await cacheSet(cacheKey, JSON.stringify(result), 300);

    return result;
  }),
});

/**
 * bumpFeedVersion — Increment feed version counter for a user
 *
 * Called on follow/unfollow to invalidate cached home timeline.
 * Uses Redis INCR for atomic monotonic increment.
 */
async function bumpFeedVersion(userId: string): Promise<void> {
  const key = `feed:version:${userId}`;
  await cacheIncr(key);
}
