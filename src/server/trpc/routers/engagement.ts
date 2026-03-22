import { paginationSchema, tweetContentSchema } from "@/lib/validators";
import { log } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, publicUserSelect } from "../../db";
import { bumpFeedVersionForFollowers } from "../../services/feed";
import { createNotification } from "../../services/notification";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../index";
import { validateMediaUrls } from "./media";

/**
 * Engagement router
 *
 * Procedures:
 * - like: like a tweet (idempotent)
 * - unlike: unlike a tweet (idempotent)
 * - retweet: retweet a tweet (blocks self-retweet)
 * - undoRetweet: undo retweet (idempotent)
 * - quoteTweet: create a tweet with quoteTweetId reference
 * - getLikers: get paginated list of users who liked a tweet
 * - getUserLikes: get paginated list of tweets a user liked
 */
export const engagementRouter = createTRPCRouter({
  /**
   * like — Like a tweet
   *
   * - Idempotent: P2002 on unique constraint is silently ignored
   * - Increments likeCount atomically with Like creation
   * - Fires LIKE notification with dedupeKey
   */
  like: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { tweetId } = input;

      // Verify tweet exists and is not deleted
      const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: { id: true, deleted: true, authorId: true },
      });

      if (!tweet || tweet.deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tweet not found",
        });
      }

      try {
        // Transaction: create Like + increment likeCount (I3)
        await prisma.$transaction([
          prisma.like.create({
            data: {
              userId,
              tweetId,
            },
          }),
          prisma.tweet.update({
            where: { id: tweetId },
            data: { likeCount: { increment: 1 } },
          }),
        ]);

        // Fire LIKE notification with dedupeKey (self-suppression in createNotification)
        await createNotification({
          recipientId: tweet.authorId,
          actorId: userId,
          type: "LIKE",
          tweetId,
          dedupeKey: `like:${userId}:${tweetId}`,
        });

        return { success: true };
      } catch (error) {
        // P2002: unique constraint violation (already liked)
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          // Idempotent: already liked, return success silently
          return { success: true };
        }

        // Log unexpected errors before re-throwing
        log.error("Failed to like tweet", {
          userId,
          tweetId,
          error: error instanceof Error ? error.message : String(error),
          requestId: ctx.requestId,
        });
        throw error;
      }
    }),

  /**
   * unlike — Unlike a tweet
   *
   * - Idempotent: if not liked, succeeds silently
   * - Decrements likeCount atomically with Like deletion
   */
  unlike: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { tweetId } = input;

      // Check if like exists
      const existingLike = await prisma.like.findUnique({
        where: {
          userId_tweetId: {
            userId,
            tweetId,
          },
        },
      });

      if (!existingLike) {
        // Not liked, return success idempotently
        return { success: true };
      }

      // Transaction: delete Like + decrement likeCount (I3)
      await prisma.$transaction([
        prisma.like.delete({
          where: {
            userId_tweetId: {
              userId,
              tweetId,
            },
          },
        }),
        prisma.tweet.update({
          where: { id: tweetId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);

      return { success: true };
    }),

  /**
   * retweet — Retweet a tweet
   *
   * - Blocks self-retweet (I6)
   * - Idempotent: P2002 on unique constraint is silently ignored
   * - Increments retweetCount atomically with Retweet creation
   * - Fires RETWEET notification with dedupeKey
   * - Bumps feed version for retweeter's followers
   */
  retweet: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { tweetId } = input;

      // Verify tweet exists and is not deleted
      const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: { id: true, deleted: true, authorId: true },
      });

      if (!tweet || tweet.deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tweet not found",
        });
      }

      // Self-retweet check (I6)
      if (tweet.authorId === userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot retweet your own tweet",
        });
      }

      try {
        // Transaction: create Retweet + increment retweetCount (I3)
        await prisma.$transaction([
          prisma.retweet.create({
            data: {
              userId,
              tweetId,
            },
          }),
          prisma.tweet.update({
            where: { id: tweetId },
            data: { retweetCount: { increment: 1 } },
          }),
        ]);

        // Fire RETWEET notification with dedupeKey (self-suppression in createNotification)
        await createNotification({
          recipientId: tweet.authorId,
          actorId: userId,
          type: "RETWEET",
          tweetId,
          dedupeKey: `retweet:${userId}:${tweetId}`,
        });

        // Bump feed version for retweeter's followers
        await bumpFeedVersionForFollowers(userId);

        return { success: true };
      } catch (error) {
        // P2002: unique constraint violation (already retweeted)
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          // Idempotent: already retweeted, return success silently
          return { success: true };
        }

        // Log unexpected errors before re-throwing
        log.error("Failed to retweet", {
          userId,
          tweetId,
          error: error instanceof Error ? error.message : String(error),
          requestId: ctx.requestId,
        });
        throw error;
      }
    }),

  /**
   * undoRetweet — Undo a retweet
   *
   * - Idempotent: if not retweeted, succeeds silently
   * - Decrements retweetCount atomically with Retweet deletion
   * - Bumps feed version for retweeter's followers
   */
  undoRetweet: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { tweetId } = input;

      // Check if retweet exists
      const existingRetweet = await prisma.retweet.findUnique({
        where: {
          userId_tweetId: {
            userId,
            tweetId,
          },
        },
      });

      if (!existingRetweet) {
        // Not retweeted, return success idempotently
        return { success: true };
      }

      // Transaction: delete Retweet + decrement retweetCount (I3)
      await prisma.$transaction([
        prisma.retweet.delete({
          where: {
            userId_tweetId: {
              userId,
              tweetId,
            },
          },
        }),
        prisma.tweet.update({
          where: { id: tweetId },
          data: { retweetCount: { decrement: 1 } },
        }),
      ]);

      // Bump feed version for retweeter's followers
      await bumpFeedVersionForFollowers(userId);

      return { success: true };
    }),

  /**
   * quoteTweet — Create a tweet with quoteTweetId reference
   *
   * - Creates a new tweet with quoteTweetId field set
   * - Validates quoted tweet exists and is not deleted
   * - Increments author.tweetCount atomically
   * - Fires QUOTE_TWEET notification to quoted tweet's author
   */
  quoteTweet: protectedProcedure
    .input(
      z.object({
        content: tweetContentSchema.optional(),
        mediaUrls: z.array(z.string().url()).max(4).optional(),
        quoteTweetId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { content, mediaUrls, quoteTweetId } = input;

      // Require text OR media (I7)
      if (!content?.trim() && (!mediaUrls || mediaUrls.length === 0)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Tweet must have text or media",
        });
      }

      // Validate media URLs if present
      if (mediaUrls && mediaUrls.length > 0) {
        validateMediaUrls(mediaUrls, userId, "tweet");
      }

      // Verify quoted tweet exists and is not deleted
      const quotedTweet = await prisma.tweet.findUnique({
        where: { id: quoteTweetId },
        select: { id: true, deleted: true, authorId: true },
      });

      if (!quotedTweet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Quoted tweet not found",
        });
      }

      if (quotedTweet.deleted) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot quote a deleted tweet",
        });
      }

      // Transaction: create tweet + increment tweetCount (I3)
      const operations: Prisma.PrismaPromise<unknown>[] = [
        prisma.tweet.create({
          data: {
            content: content?.trim() || "",
            authorId: userId,
            quoteTweetId,
            mediaUrls: mediaUrls || [],
          },
          select: {
            id: true,
            content: true,
            authorId: true,
            quoteTweetId: true,
            mediaUrls: true,
            createdAt: true,
            likeCount: true,
            retweetCount: true,
            replyCount: true,
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { tweetCount: { increment: 1 } },
        }),
      ];

      const [tweetResult] = await prisma.$transaction(operations);

      // Type assertion: first operation is tweet.create with known select
      const tweet = tweetResult as {
        id: string;
        content: string;
        authorId: string;
        quoteTweetId: string | null;
        mediaUrls: string[];
        createdAt: Date;
        likeCount: number;
        retweetCount: number;
        replyCount: number;
      };

      // Fire QUOTE_TWEET notification to quoted tweet's author (self-suppression handled)
      await createNotification({
        recipientId: quotedTweet.authorId,
        actorId: userId,
        type: "QUOTE_TWEET",
        tweetId: tweet.id,
      });

      return tweet;
    }),

  /**
   * getLikers — Get paginated list of users who liked a tweet
   *
   * Returns user profiles with publicUserSelect.
   * Ordered by Like.createdAt DESC (most recent likes first).
   */
  getLikers: publicProcedure
    .input(
      z
        .object({
          tweetId: z.string(),
        })
        .merge(paginationSchema)
    )
    .query(async ({ input }) => {
      const { tweetId, cursor, limit } = input;

      const likes = await prisma.like.findMany({
        where: { tweetId },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        cursor: cursor ? { userId_tweetId: parseLikeCursor(cursor) } : undefined,
        include: {
          user: { select: publicUserSelect },
        },
      });

      let nextCursor: string | null = null;
      if (likes.length > limit) {
        const nextItem = likes.pop();
        nextCursor = nextItem ? `${nextItem.userId}:${nextItem.tweetId}` : null;
      }

      return {
        items: likes.map((like) => like.user),
        nextCursor,
      };
    }),

  /**
   * getUserLikes — Get paginated list of tweets a user liked
   *
   * Powers the 'Likes' profile tab.
   * Returns tweet data with author info.
   * Ordered by Like.createdAt DESC (most recent likes first).
   */
  getUserLikes: publicProcedure
    .input(
      z
        .object({
          userId: z.string(),
        })
        .merge(paginationSchema)
    )
    .query(async ({ input }) => {
      const { userId, cursor, limit } = input;

      const likes = await prisma.like.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        cursor: cursor ? { userId_tweetId: parseLikeCursor(cursor) } : undefined,
        include: {
          tweet: {
            select: {
              id: true,
              content: true,
              authorId: true,
              parentId: true,
              quoteTweetId: true,
              mediaUrls: true,
              createdAt: true,
              likeCount: true,
              retweetCount: true,
              replyCount: true,
              deleted: true,
              author: { select: publicUserSelect },
            },
          },
        },
      });

      let nextCursor: string | null = null;
      if (likes.length > limit) {
        const nextItem = likes.pop();
        nextCursor = nextItem ? `${nextItem.userId}:${nextItem.tweetId}` : null;
      }

      // Filter out deleted tweets
      const items = likes
        .filter((like) => !like.tweet.deleted)
        .map((like) => {
          const { deleted: _, ...tweetData } = like.tweet;
          return tweetData;
        });

      return {
        items,
        nextCursor,
      };
    }),
});

/**
 * parseLikeCursor — Parse composite cursor for Like pagination
 *
 * Cursor format: "userId:tweetId"
 */
function parseLikeCursor(cursor: string): { userId: string; tweetId: string } {
  const [userId, tweetId] = cursor.split(":");
  if (!userId || !tweetId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid cursor",
    });
  }
  return { userId, tweetId };
}
