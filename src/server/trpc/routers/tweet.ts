import { tweetContentSchema } from "@/lib/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, publicUserSelect } from "../../db";
import { redis } from "../../redis";
import { validateMediaUrls } from "./media";
import { createNotification } from "../../services/notification";
import { parseMentions, resolveMentions } from "../../services/mention";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../index";

/**
 * Tweet router
 *
 * Procedures:
 * - create: create tweet or reply with text/media
 * - delete: soft-delete tweet (author only)
 * - getById: get single tweet by ID
 * - getReplies: get paginated replies to a tweet
 * - getUserTweets: get user's top-level tweets (not replies)
 * - getUserReplies: get user's replies
 */
export const tweetRouter = createTRPCRouter({
  /**
   * create — Create a new tweet or reply
   *
   * - Validates content length (280 chars max)
   * - Requires text OR media (cannot be both empty)
   * - Parses @mentions and fires MENTION notifications
   * - If parentId: verifies parent exists and is not deleted
   * - Atomic count updates (tweetCount, replyCount)
   */
  create: protectedProcedure
    .input(
      z.object({
        content: tweetContentSchema.optional(),
        mediaUrls: z.array(z.string().url()).max(4).optional(),
        parentId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { content, mediaUrls, parentId } = input;

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

      // If reply: verify parent exists and is not deleted
      if (parentId) {
        const parent = await prisma.tweet.findUnique({
          where: { id: parentId },
          select: { id: true, deleted: true },
        });

        if (!parent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Parent tweet not found",
          });
        }

        if (parent.deleted) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot reply to a deleted tweet",
          });
        }
      }

      // Parse mentions from content
      const mentionedUsernames = content ? parseMentions(content) : [];
      const mentionedUserIds = await resolveMentions(mentionedUsernames);

      // Transaction: create tweet + increment counts (I3)
      const operations: any[] = [
        prisma.tweet.create({
          data: {
            content: content?.trim() || "",
            authorId: userId,
            parentId,
            mediaUrls: mediaUrls || [],
          },
          select: {
            id: true,
            content: true,
            authorId: true,
            parentId: true,
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

      // If reply: increment parent's replyCount
      if (parentId) {
        operations.push(
          prisma.tweet.update({
            where: { id: parentId },
            data: { replyCount: { increment: 1 } },
          })
        );
      }

      const [tweet] = await prisma.$transaction(operations);

      // Fire MENTION notifications (self-suppression handled in createNotification)
      await Promise.all(
        mentionedUserIds.map((mentionedUserId) =>
          createNotification({
            recipientId: mentionedUserId,
            actorId: userId,
            type: "MENTION",
            tweetId: tweet.id,
          })
        )
      );

      // Fire REPLY notification if this is a reply
      if (parentId) {
        // Get parent author for notification
        const parent = await prisma.tweet.findUnique({
          where: { id: parentId },
          select: { authorId: true },
        });

        if (parent) {
          await createNotification({
            recipientId: parent.authorId,
            actorId: userId,
            type: "REPLY",
            tweetId: tweet.id,
          });
        }
      }

      return tweet;
    }),

  /**
   * delete — Soft-delete a tweet
   *
   * - Author-only (FORBIDDEN for others)
   * - Sets deleted=true, deletedAt=now()
   * - Atomic count decrements (tweetCount, replyCount if reply)
   * - Adds to Redis tombstones:tweets set (60s TTL)
   * - Publishes tweet_deleted SSE event (TODO: E1)
   */
  delete: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { tweetId } = input;

      // Fetch tweet to verify ownership
      const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: {
          id: true,
          authorId: true,
          parentId: true,
          deleted: true,
        },
      });

      if (!tweet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tweet not found",
        });
      }

      if (tweet.deleted) {
        // Already deleted, idempotent success
        return { success: true };
      }

      // Verify ownership (I1.14)
      if (tweet.authorId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own tweets",
        });
      }

      // Transaction: soft-delete + decrement counts (I3)
      const operations: any[] = [
        prisma.tweet.update({
          where: { id: tweetId },
          data: {
            deleted: true,
            deletedAt: new Date(),
          },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { tweetCount: { decrement: 1 } },
        }),
      ];

      // If reply: decrement parent's replyCount
      if (tweet.parentId) {
        operations.push(
          prisma.tweet.update({
            where: { id: tweet.parentId },
            data: { replyCount: { decrement: 1 } },
          })
        );
      }

      await prisma.$transaction(operations);

      // Add to Redis tombstones set with 60s TTL (fail-open)
      try {
        await redis.sadd("tombstones:tweets", tweetId);
        await redis.expire("tombstones:tweets", 60);
      } catch (error) {
        console.warn("[REDIS] Failed to add tweet to tombstones (fail open):", {
          tweetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // TODO (E1): Publish tweet_deleted SSE event
      // This will be implemented in Phase E when SSE publisher is available

      return { success: true };
    }),

  /**
   * getById — Get a single tweet by ID
   *
   * - Returns publicUserSelect for author (I1, I2)
   * - Deleted tweets return NOT_FOUND (I5)
   * - If authenticated: includes hasLiked/hasRetweeted for current user
   */
  getById: publicProcedure
    .input(z.object({ tweetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { tweetId } = input;

      const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: {
          id: true,
          content: true,
          authorId: true,
          parentId: true,
          mediaUrls: true,
          createdAt: true,
          likeCount: true,
          retweetCount: true,
          replyCount: true,
          deleted: true,
          author: { select: publicUserSelect },
        },
      });

      if (!tweet || tweet.deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tweet not found",
        });
      }

      // If authenticated: check if current user has liked/retweeted this tweet
      let hasLiked = false;
      let hasRetweeted = false;

      if (ctx.session?.user?.id) {
        const userId = ctx.session.user.id;

        // Batch check for engagement (§1.16)
        const [like, retweet] = await Promise.all([
          prisma.like.findUnique({
            where: {
              userId_tweetId: {
                userId,
                tweetId,
              },
            },
          }),
          prisma.retweet.findUnique({
            where: {
              userId_tweetId: {
                userId,
                tweetId,
              },
            },
          }),
        ]);

        hasLiked = !!like;
        hasRetweeted = !!retweet;
      }

      // Remove deleted field from response
      const { deleted: _, ...tweetData } = tweet;

      return {
        ...tweetData,
        hasLiked,
        hasRetweeted,
      };
    }),

  /**
   * getReplies — Get paginated replies to a tweet
   *
   * - WHERE parentId = tweetId AND deleted = false
   * - Cursor-based pagination (cursor = tweet.id)
   * - Ordered by createdAt DESC (most recent first)
   */
  getReplies: publicProcedure
    .input(
      z.object({
        tweetId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const { tweetId, cursor, limit } = input;

      const replies = await prisma.tweet.findMany({
        where: {
          parentId: tweetId,
          deleted: false,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        select: {
          id: true,
          content: true,
          authorId: true,
          parentId: true,
          mediaUrls: true,
          createdAt: true,
          likeCount: true,
          retweetCount: true,
          replyCount: true,
          author: { select: publicUserSelect },
        },
      });

      let nextCursor: string | null = null;
      if (replies.length > limit) {
        const nextItem = replies.pop();
        nextCursor = nextItem?.id ?? null;
      }

      return {
        items: replies,
        nextCursor,
      };
    }),

  /**
   * getUserTweets — Get user's top-level tweets (not replies)
   *
   * - WHERE authorId AND deleted = false AND parentId IS NULL
   * - Cursor-based pagination
   * - Ordered by createdAt DESC
   */
  getUserTweets: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const { userId, cursor, limit } = input;

      const tweets = await prisma.tweet.findMany({
        where: {
          authorId: userId,
          deleted: false,
          parentId: null,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        select: {
          id: true,
          content: true,
          authorId: true,
          parentId: true,
          mediaUrls: true,
          createdAt: true,
          likeCount: true,
          retweetCount: true,
          replyCount: true,
          author: { select: publicUserSelect },
        },
      });

      let nextCursor: string | null = null;
      if (tweets.length > limit) {
        const nextItem = tweets.pop();
        nextCursor = nextItem?.id ?? null;
      }

      return {
        items: tweets,
        nextCursor,
      };
    }),

  /**
   * getUserReplies — Get user's replies
   *
   * - WHERE authorId AND deleted = false AND parentId IS NOT NULL
   * - Cursor-based pagination
   * - Ordered by createdAt DESC
   */
  getUserReplies: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const { userId, cursor, limit } = input;

      const replies = await prisma.tweet.findMany({
        where: {
          authorId: userId,
          deleted: false,
          parentId: { not: null },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        select: {
          id: true,
          content: true,
          authorId: true,
          parentId: true,
          mediaUrls: true,
          createdAt: true,
          likeCount: true,
          retweetCount: true,
          replyCount: true,
          author: { select: publicUserSelect },
        },
      });

      let nextCursor: string | null = null;
      if (replies.length > limit) {
        const nextItem = replies.pop();
        nextCursor = nextItem?.id ?? null;
      }

      return {
        items: replies,
        nextCursor,
      };
    }),
});
