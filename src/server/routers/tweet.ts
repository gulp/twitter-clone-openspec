import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../trpc";

export const tweetRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        content: z.string().min(1).max(280),
        parentId: z.string().optional(),
        quoteTweetId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const tweet = await ctx.prisma.tweet.create({
        data: {
          content: input.content,
          authorId: ctx.session.user.id,
          parentId: input.parentId,
          quoteTweetId: input.quoteTweetId,
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
        },
      });

      // Parse mentions and create notifications
      const mentions = input.content.match(/@(\w+)/g);
      if (mentions) {
        for (const mention of mentions) {
          const username = mention.slice(1);
          const mentionedUser = await ctx.prisma.user.findUnique({
            where: { username },
          });
          if (mentionedUser && mentionedUser.id !== ctx.session.user.id) {
            await ctx.prisma.notification.create({
              data: {
                recipientId: mentionedUser.id,
                type: "mention",
                actorId: ctx.session.user.id,
                tweetId: tweet.id,
              },
            });
          }
        }
      }

      // Notify parent tweet author for replies
      if (input.parentId) {
        const parent = await ctx.prisma.tweet.findUnique({
          where: { id: input.parentId },
        });
        if (parent && parent.authorId !== ctx.session.user.id) {
          await ctx.prisma.notification.create({
            data: {
              recipientId: parent.authorId,
              type: "reply",
              actorId: ctx.session.user.id,
              tweetId: tweet.id,
            },
          });
        }
      }

      return tweet;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tweet = await ctx.prisma.tweet.findUnique({
        where: { id: input.id },
      });
      if (!tweet || tweet.authorId !== ctx.session.user.id) {
        throw new Error("Not authorized");
      }
      return ctx.prisma.tweet.update({
        where: { id: input.id },
        data: { deleted: true },
      });
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const tweet = await ctx.prisma.tweet.findUnique({
        where: { id: input.id, deleted: false },
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
      });
      if (!tweet) throw new Error("Tweet not found");

      let liked = false;
      let retweeted = false;
      if (ctx.session?.user) {
        const [likeRecord, retweetRecord] = await Promise.all([
          ctx.prisma.like.findUnique({
            where: {
              userId_tweetId: {
                userId: ctx.session.user.id,
                tweetId: input.id,
              },
            },
          }),
          ctx.prisma.retweet.findUnique({
            where: {
              userId_tweetId: {
                userId: ctx.session.user.id,
                tweetId: input.id,
              },
            },
          }),
        ]);
        liked = !!likeRecord;
        retweeted = !!retweetRecord;
      }

      return { ...tweet, liked, retweeted };
    }),

  getReplies: publicProcedure
    .input(z.object({ tweetId: z.string(), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const replies = await ctx.prisma.tweet.findMany({
        where: { parentId: input.tweetId, deleted: false },
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
        },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "asc" },
      });

      let likedTweetIds: Set<string> = new Set();
      let retweetedTweetIds: Set<string> = new Set();
      if (ctx.session?.user) {
        const tweetIds = replies.map((r) => r.id);
        const [likes, retweets] = await Promise.all([
          ctx.prisma.like.findMany({
            where: { userId: ctx.session.user.id, tweetId: { in: tweetIds } },
          }),
          ctx.prisma.retweet.findMany({
            where: { userId: ctx.session.user.id, tweetId: { in: tweetIds } },
          }),
        ]);
        likedTweetIds = new Set(likes.map((l) => l.tweetId));
        retweetedTweetIds = new Set(retweets.map((r) => r.tweetId));
      }

      return {
        replies: replies.map((r) => ({
          ...r,
          liked: likedTweetIds.has(r.id),
          retweeted: retweetedTweetIds.has(r.id),
        })),
        nextCursor:
          replies.length === 20 ? replies[replies.length - 1].id : null,
      };
    }),

  search: publicProcedure
    .input(z.object({ query: z.string(), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const tweets = await ctx.prisma.tweet.findMany({
        where: {
          content: { contains: input.query },
          deleted: false,
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
        },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });
      return {
        tweets: tweets.map((t) => ({ ...t, liked: false, retweeted: false })),
        nextCursor:
          tweets.length === 20 ? tweets[tweets.length - 1].id : null,
      };
    }),
});
