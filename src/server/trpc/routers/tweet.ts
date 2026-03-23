import { log } from "@/lib/logger";
import { tweetContentSchema } from "@/lib/validators";
import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, publicUserSelect } from "../../db";
import { redis } from "../../redis";
import { bumpFeedVersionForFollowers } from "../../services/feed";
import { parseMentions, resolveMentions } from "../../services/mention";
import { createNotification } from "../../services/notification";
import { publishNewTweet, publishTweetDeleted } from "../../services/sse-publisher";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../index";
import { validateMediaUrls } from "./media";

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
      let parentAuthorId: string | null = null;
      if (parentId) {
        const parent = await prisma.tweet.findUnique({
          where: { id: parentId },
          select: { id: true, deleted: true, authorId: true },
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

        parentAuthorId = parent.authorId;
      }

      // Parse mentions from content
      const mentionedUsernames = content ? parseMentions(content) : [];
      const mentionedUserIds = await resolveMentions(mentionedUsernames);

      // Transaction: create tweet + increment counts (I3)
      const operations: Prisma.PrismaPromise<unknown>[] = [
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

      const [tweetResult] = await prisma.$transaction(operations);

      // Type assertion: first operation is tweet.create with known select
      const tweet = tweetResult as {
        id: string;
        content: string;
        authorId: string;
        parentId: string | null;
        mediaUrls: string[];
        createdAt: Date;
        likeCount: number;
        retweetCount: number;
        replyCount: number;
      };

      // Fire MENTION notifications (self-suppression handled in createNotification)
      // Best-effort: fail-open (§4, §10)
      await Promise.all(
        mentionedUserIds.map(async (mentionedUserId) => {
          try {
            await createNotification({
              recipientId: mentionedUserId,
              actorId: userId,
              type: "MENTION",
              tweetId: tweet.id,
            });
          } catch (error) {
            log.warn("Failed to create MENTION notification (fail open)", {
              userId,
              mentionedUserId,
              tweetId: tweet.id,
              error: error instanceof Error ? error.message : String(error),
              requestId: ctx.requestId,
            });
          }
        })
      );

      // Fire REPLY notification if this is a reply
      // Best-effort: fail-open (§4, §10)
      if (parentId && parentAuthorId) {
        try {
          await createNotification({
            recipientId: parentAuthorId,
            actorId: userId,
            type: "REPLY",
            tweetId: tweet.id,
          });
        } catch (error) {
          log.warn("Failed to create REPLY notification (fail open)", {
            userId,
            parentAuthorId,
            tweetId: tweet.id,
            error: error instanceof Error ? error.message : String(error),
            requestId: ctx.requestId,
          });
        }
      }

      // Publish new-tweet SSE event to all followers (best-effort, fail-open)
      // Only publish top-level tweets to home timeline, not replies
      if (!parentId) {
        const author = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });

        if (author) {
          await publishNewTweet(userId, tweet.id, author.username);
        }

        // Bump feed version for all followers (invalidates cached home timelines)
        await bumpFeedVersionForFollowers(userId);
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
   * - Uses updateMany with WHERE deleted=false to prevent concurrent delete race
   */
  delete: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { tweetId } = input;

      // Fetch tweet to verify ownership and get parentId
      const tweet = await prisma.tweet.findUnique({
        where: { id: tweetId },
        select: {
          id: true,
          authorId: true,
          parentId: true,
        },
      });

      if (!tweet) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Tweet not found",
        });
      }

      // Verify ownership (I1.14)
      if (tweet.authorId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own tweets",
        });
      }

      // Atomic update: only mark as deleted if not already deleted
      // This prevents race conditions where two concurrent deletes both pass the check
      // Pattern from auth.ts:269-296 completeReset
      const updateResult = await prisma.tweet.updateMany({
        where: {
          id: tweetId,
          deleted: false,
        },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      // If count is 0, the tweet was already deleted by a concurrent request
      if (updateResult.count === 0) {
        // Already deleted, idempotent success
        return { success: true };
      }

      // Now decrement counts (only executed if the update succeeded)
      const operations: Prisma.PrismaPromise<unknown>[] = [
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

      // Add to Redis tombstones sorted set with independent 60s expiry (fail-open)
      try {
        const now = Date.now();
        const expiryTimestamp = now + 60000; // 60 seconds from now
        await redis.zadd("tombstones:tweets", expiryTimestamp, tweetId);
      } catch (error) {
        log.warn("Failed to add tweet to tombstones (fail open)", {
          feature: "tombstones",
          tweetId,
          error: error instanceof Error ? error.message : String(error),
          requestId: ctx.requestId,
        });
      }

      // Publish tweet_deleted SSE event to all followers (best-effort, fail-open)
      await publishTweetDeleted(userId, tweetId);

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
          quoteTweetId: true,
          mediaUrls: true,
          createdAt: true,
          likeCount: true,
          retweetCount: true,
          replyCount: true,
          deleted: true,
          author: { select: publicUserSelect },
          quotedTweet: {
            select: {
              id: true,
              content: true,
              mediaUrls: true,
              deleted: true,
              author: {
                select: {
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
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

      // Remove deleted field from response and redact deleted quoted tweets (I5)
      const { deleted: _, quotedTweet: rawQuotedTweet, ...tweetData } = tweet;

      const quotedTweet = rawQuotedTweet?.deleted
        ? null
        : rawQuotedTweet
          ? {
              id: rawQuotedTweet.id,
              content: rawQuotedTweet.content,
              mediaUrls: rawQuotedTweet.mediaUrls,
              author: rawQuotedTweet.author,
            }
          : null;

      return {
        ...tweetData,
        quotedTweet,
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
    .query(async ({ ctx, input }) => {
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
          quoteTweetId: true,
          mediaUrls: true,
          createdAt: true,
          likeCount: true,
          retweetCount: true,
          replyCount: true,
          author: { select: publicUserSelect },
          quotedTweet: {
            select: {
              id: true,
              content: true,
              mediaUrls: true,
              deleted: true,
              author: {
                select: {
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

      let nextCursor: string | null = null;
      if (replies.length > limit) {
        const nextItem = replies.pop();
        nextCursor = nextItem?.id ?? null;
      }

      // If authenticated: batch-check hasLiked/hasRetweeted
      let hasLikedSet = new Set<string>();
      let hasRetweetedSet = new Set<string>();

      if (ctx.session?.user?.id) {
        const currentUserId = ctx.session.user.id;
        const tweetIds = replies.map((t) => t.id);

        if (tweetIds.length > 0) {
          const [liked, retweeted] = await Promise.all([
            prisma.like.findMany({
              where: { userId: currentUserId, tweetId: { in: tweetIds } },
              select: { tweetId: true },
            }),
            prisma.retweet.findMany({
              where: { userId: currentUserId, tweetId: { in: tweetIds } },
              select: { tweetId: true },
            }),
          ]);

          hasLikedSet = new Set(liked.map((l) => l.tweetId));
          hasRetweetedSet = new Set(retweeted.map((r) => r.tweetId));
        }
      }

      // Annotate replies with engagement state and redact deleted quoted tweets (I5)
      const items = replies.map((reply) => {
        const quotedTweet = reply.quotedTweet?.deleted
          ? null
          : reply.quotedTweet
            ? ({
                id: reply.quotedTweet.id,
                content: reply.quotedTweet.content,
                mediaUrls: reply.quotedTweet.mediaUrls,
                author: reply.quotedTweet.author,
              } as const)
            : null;

        return {
          ...reply,
          quotedTweet,
          hasLiked: hasLikedSet.has(reply.id),
          hasRetweeted: hasRetweetedSet.has(reply.id),
        };
      });

      return {
        items,
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
    .query(async ({ ctx, input }) => {
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
          quoteTweetId: true,
          mediaUrls: true,
          createdAt: true,
          likeCount: true,
          retweetCount: true,
          replyCount: true,
          author: { select: publicUserSelect },
          quotedTweet: {
            select: {
              id: true,
              content: true,
              mediaUrls: true,
              deleted: true,
              author: {
                select: {
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

      let nextCursor: string | null = null;
      if (tweets.length > limit) {
        const nextItem = tweets.pop();
        nextCursor = nextItem?.id ?? null;
      }

      // If authenticated: batch-check hasLiked/hasRetweeted
      let hasLikedSet = new Set<string>();
      let hasRetweetedSet = new Set<string>();

      if (ctx.session?.user?.id) {
        const currentUserId = ctx.session.user.id;
        const tweetIds = tweets.map((t) => t.id);

        if (tweetIds.length > 0) {
          const [liked, retweeted] = await Promise.all([
            prisma.like.findMany({
              where: { userId: currentUserId, tweetId: { in: tweetIds } },
              select: { tweetId: true },
            }),
            prisma.retweet.findMany({
              where: { userId: currentUserId, tweetId: { in: tweetIds } },
              select: { tweetId: true },
            }),
          ]);

          hasLikedSet = new Set(liked.map((l) => l.tweetId));
          hasRetweetedSet = new Set(retweeted.map((r) => r.tweetId));
        }
      }

      // Annotate tweets with engagement state and redact deleted quoted tweets (I5)
      const items = tweets.map((tweet) => {
        const { quotedTweet: rawQuotedTweet, ...tweetData } = tweet;
        const quotedTweet = rawQuotedTweet?.deleted
          ? null
          : rawQuotedTweet
            ? {
                id: rawQuotedTweet.id,
                content: rawQuotedTweet.content,
                mediaUrls: rawQuotedTweet.mediaUrls,
                author: rawQuotedTweet.author,
              }
            : null;

        return {
          ...tweetData,
          quotedTweet,
          hasLiked: hasLikedSet.has(tweet.id),
          hasRetweeted: hasRetweetedSet.has(tweet.id),
        };
      });

      return {
        items,
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
    .query(async ({ ctx, input }) => {
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
          quoteTweetId: true,
          mediaUrls: true,
          createdAt: true,
          likeCount: true,
          retweetCount: true,
          replyCount: true,
          author: { select: publicUserSelect },
          quotedTweet: {
            select: {
              id: true,
              content: true,
              mediaUrls: true,
              deleted: true,
              author: {
                select: {
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

      let nextCursor: string | null = null;
      if (replies.length > limit) {
        const nextItem = replies.pop();
        nextCursor = nextItem?.id ?? null;
      }

      // If authenticated: batch-check hasLiked/hasRetweeted
      let hasLikedSet = new Set<string>();
      let hasRetweetedSet = new Set<string>();

      if (ctx.session?.user?.id) {
        const currentUserId = ctx.session.user.id;
        const tweetIds = replies.map((t) => t.id);

        if (tweetIds.length > 0) {
          const [liked, retweeted] = await Promise.all([
            prisma.like.findMany({
              where: { userId: currentUserId, tweetId: { in: tweetIds } },
              select: { tweetId: true },
            }),
            prisma.retweet.findMany({
              where: { userId: currentUserId, tweetId: { in: tweetIds } },
              select: { tweetId: true },
            }),
          ]);

          hasLikedSet = new Set(liked.map((l) => l.tweetId));
          hasRetweetedSet = new Set(retweeted.map((r) => r.tweetId));
        }
      }

      // Annotate replies with engagement state and redact deleted quoted tweets (I5)
      const items = replies.map((reply) => {
        const { quotedTweet: rawQuotedTweet, ...replyData } = reply;
        const quotedTweet = rawQuotedTweet?.deleted
          ? null
          : rawQuotedTweet
            ? {
                id: rawQuotedTweet.id,
                content: rawQuotedTweet.content,
                mediaUrls: rawQuotedTweet.mediaUrls,
                author: rawQuotedTweet.author,
              }
            : null;

        return {
          ...replyData,
          quotedTweet,
          hasLiked: hasLikedSet.has(reply.id),
          hasRetweeted: hasRetweetedSet.has(reply.id),
        };
      });

      return {
        items,
        nextCursor,
      };
    }),
});
