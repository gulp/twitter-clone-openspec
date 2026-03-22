import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

export const socialRouter = router({
  follow: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot follow yourself",
        });
      }

      await ctx.prisma.follow.upsert({
        where: {
          followerId_followingId: {
            followerId: ctx.session.user.id,
            followingId: input.userId,
          },
        },
        update: {},
        create: {
          followerId: ctx.session.user.id,
          followingId: input.userId,
        },
      });

      // Create notification
      await ctx.prisma.notification.create({
        data: {
          recipientId: input.userId,
          type: "follow",
          actorId: ctx.session.user.id,
        },
      });

      return { success: true };
    }),

  unfollow: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.follow.deleteMany({
        where: {
          followerId: ctx.session.user.id,
          followingId: input.userId,
        },
      });
      return { success: true };
    }),

  getFollowers: publicProcedure
    .input(
      z.object({ username: z.string(), cursor: z.string().optional() })
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { username: input.username },
      });
      if (!user) throw new Error("User not found");

      const follows = await ctx.prisma.follow.findMany({
        where: { followingId: user.id },
        include: {
          follower: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
              bio: true,
            },
          },
        },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });

      return {
        users: follows.map((f) => f.follower),
        nextCursor:
          follows.length === 20 ? follows[follows.length - 1].id : null,
      };
    }),

  getFollowing: publicProcedure
    .input(
      z.object({ username: z.string(), cursor: z.string().optional() })
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { username: input.username },
      });
      if (!user) throw new Error("User not found");

      const follows = await ctx.prisma.follow.findMany({
        where: { followerId: user.id },
        include: {
          following: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
              bio: true,
            },
          },
        },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });

      return {
        users: follows.map((f) => f.following),
        nextCursor:
          follows.length === 20 ? follows[follows.length - 1].id : null,
      };
    }),

  like: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.like.findUnique({
        where: {
          userId_tweetId: {
            userId: ctx.session.user.id,
            tweetId: input.tweetId,
          },
        },
      });
      if (existing) return { success: true };

      await ctx.prisma.like.create({
        data: { userId: ctx.session.user.id, tweetId: input.tweetId },
      });

      // Notify tweet author
      const tweet = await ctx.prisma.tweet.findUnique({
        where: { id: input.tweetId },
      });
      if (tweet && tweet.authorId !== ctx.session.user.id) {
        await ctx.prisma.notification.create({
          data: {
            recipientId: tweet.authorId,
            type: "like",
            actorId: ctx.session.user.id,
            tweetId: input.tweetId,
          },
        });
      }

      return { success: true };
    }),

  unlike: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.like.deleteMany({
        where: { userId: ctx.session.user.id, tweetId: input.tweetId },
      });
      return { success: true };
    }),

  retweet: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tweet = await ctx.prisma.tweet.findUnique({
        where: { id: input.tweetId },
      });
      if (!tweet) throw new Error("Tweet not found");
      if (tweet.authorId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot retweet your own tweet",
        });
      }

      const existing = await ctx.prisma.retweet.findUnique({
        where: {
          userId_tweetId: {
            userId: ctx.session.user.id,
            tweetId: input.tweetId,
          },
        },
      });
      if (existing) return { success: true };

      await ctx.prisma.retweet.create({
        data: { userId: ctx.session.user.id, tweetId: input.tweetId },
      });

      if (tweet.authorId !== ctx.session.user.id) {
        await ctx.prisma.notification.create({
          data: {
            recipientId: tweet.authorId,
            type: "retweet",
            actorId: ctx.session.user.id,
            tweetId: input.tweetId,
          },
        });
      }

      return { success: true };
    }),

  unretweet: protectedProcedure
    .input(z.object({ tweetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.retweet.deleteMany({
        where: { userId: ctx.session.user.id, tweetId: input.tweetId },
      });
      return { success: true };
    }),
});
