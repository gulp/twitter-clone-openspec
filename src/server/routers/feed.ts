import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../trpc";

export const feedRouter = router({
  home: protectedProcedure
    .input(z.object({ cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const following = await ctx.prisma.follow.findMany({
        where: { followerId: ctx.session.user.id },
        select: { followingId: true },
      });
      const followingIds = [
        ...following.map((f) => f.followingId),
        ctx.session.user.id,
      ];

      const tweets = await ctx.prisma.tweet.findMany({
        where: {
          authorId: { in: followingIds },
          deleted: false,
          parentId: null, // Don't show replies in main feed
        },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          _count: {
            select: {
              likes: true,
              retweets: true,
              replies: { where: { deleted: false } },
            },
          },
          quoteTweet: {
            include: {
              author: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });

      const tweetIds = tweets.map((t) => t.id);
      const [likes, retweets] = await Promise.all([
        ctx.prisma.like.findMany({
          where: { userId: ctx.session.user.id, tweetId: { in: tweetIds } },
        }),
        ctx.prisma.retweet.findMany({
          where: { userId: ctx.session.user.id, tweetId: { in: tweetIds } },
        }),
      ]);
      const likedIds = new Set(likes.map((l) => l.tweetId));
      const retweetedIds = new Set(retweets.map((r) => r.tweetId));

      return {
        tweets: tweets.map((t) => ({
          ...t,
          liked: likedIds.has(t.id),
          retweeted: retweetedIds.has(t.id),
        })),
        nextCursor:
          tweets.length === 20 ? tweets[tweets.length - 1].id : null,
      };
    }),

  userTimeline: publicProcedure
    .input(
      z.object({
        username: z.string(),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { username: input.username },
      });
      if (!user) throw new Error("User not found");

      const tweets = await ctx.prisma.tweet.findMany({
        where: { authorId: user.id, deleted: false, parentId: null },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          _count: {
            select: {
              likes: true,
              retweets: true,
              replies: { where: { deleted: false } },
            },
          },
          quoteTweet: {
            include: {
              author: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });

      let likedIds = new Set<string>();
      let retweetedIds = new Set<string>();
      if (ctx.session?.user) {
        const tweetIds = tweets.map((t) => t.id);
        const [likes, retweets] = await Promise.all([
          ctx.prisma.like.findMany({
            where: {
              userId: ctx.session.user.id,
              tweetId: { in: tweetIds },
            },
          }),
          ctx.prisma.retweet.findMany({
            where: {
              userId: ctx.session.user.id,
              tweetId: { in: tweetIds },
            },
          }),
        ]);
        likedIds = new Set(likes.map((l) => l.tweetId));
        retweetedIds = new Set(retweets.map((r) => r.tweetId));
      }

      return {
        tweets: tweets.map((t) => ({
          ...t,
          liked: likedIds.has(t.id),
          retweeted: retweetedIds.has(t.id),
        })),
        nextCursor:
          tweets.length === 20 ? tweets[tweets.length - 1].id : null,
      };
    }),
});
