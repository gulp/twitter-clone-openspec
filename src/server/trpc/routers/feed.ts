import { paginationSchema } from "@/lib/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, publicUserSelect } from "../../db";
import { assembleFeed } from "../../services/feed";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../index";

/**
 * Feed router
 *
 * Procedures:
 * - home: get authenticated user's home timeline (tweets from followed users)
 * - userTimeline: get a specific user's top-level tweets (not replies)
 */
export const feedRouter = createTRPCRouter({
  /**
   * home — Get home timeline for authenticated user
   *
   * Returns tweets from followed users (fan-out-on-read) with:
   * - Redis caching with version-based invalidation
   * - Tombstone filtering for deleted tweets
   * - SETNX lock to prevent thundering-herd cache rebuilds
   * - Deduplication of tweets seen via multiple paths
   * - hasLiked/hasRetweeted annotation for current user
   * - Cursor-based pagination (cursor = base64 encoded { effectiveAt, tweetId })
   */
  home: protectedProcedure.input(paginationSchema).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const { cursor, limit } = input;

    return await assembleFeed(userId, cursor, limit);
  }),

  /**
   * userTimeline — Get a specific user's top-level tweets
   *
   * Returns user's original tweets (not replies) in reverse-chronological order.
   * - WHERE authorId AND deleted = false AND parentId IS NULL
   * - Cursor-based pagination (cursor = tweet.id)
   * - No caching (simpler than home feed)
   * - If authenticated: includes hasLiked/hasRetweeted for current user
   */
  userTimeline: publicProcedure
    .input(
      z
        .object({
          userId: z.string(),
        })
        .merge(paginationSchema)
    )
    .query(async ({ ctx, input }) => {
      const { userId, cursor, limit } = input;

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Fetch user's top-level tweets
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
        },
      });

      // Determine nextCursor
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

      // Annotate tweets with engagement state
      const items = tweets.map((tweet) => ({
        ...tweet,
        hasLiked: hasLikedSet.has(tweet.id),
        hasRetweeted: hasRetweetedSet.has(tweet.id),
      }));

      return {
        items,
        nextCursor,
      };
    }),
});
