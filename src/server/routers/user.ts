import { z } from "zod";
import bcrypt from "bcryptjs";
import { router, publicProcedure, protectedProcedure } from "../trpc";

export const userRouter = router({
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        username: z
          .string()
          .min(3)
          .max(15)
          .regex(/^[a-zA-Z0-9_]+$/),
        displayName: z.string().min(1).max(50),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existingEmail = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });
      if (existingEmail) throw new Error("Email already in use");

      const existingUsername = await ctx.prisma.user.findUnique({
        where: { username: input.username },
      });
      if (existingUsername) throw new Error("Username already taken");

      const hashedPassword = await bcrypt.hash(input.password, 10);
      const user = await ctx.prisma.user.create({
        data: {
          email: input.email,
          username: input.username,
          displayName: input.displayName,
          hashedPassword,
        },
      });
      return { id: user.id, username: user.username };
    }),

  getByUsername: publicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { username: input.username },
        select: {
          id: true,
          username: true,
          displayName: true,
          bio: true,
          avatarUrl: true,
          bannerUrl: true,
          createdAt: true,
          _count: {
            select: {
              tweets: { where: { deleted: false } },
              followers: true,
              following: true,
            },
          },
        },
      });
      if (!user) return null;

      let isFollowing = false;
      if (ctx.session?.user) {
        const follow = await ctx.prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: ctx.session.user.id,
              followingId: user.id,
            },
          },
        });
        isFollowing = !!follow;
      }

      return { ...user, isFollowing };
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        displayName: z.string().min(1).max(50).optional(),
        bio: z.string().max(160).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: input,
      });
    }),

  search: publicProcedure
    .input(z.object({ query: z.string(), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const users = await ctx.prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: input.query } },
            { displayName: { contains: input.query } },
          ],
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          bio: true,
          avatarUrl: true,
          _count: { select: { followers: true } },
        },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { followers: { _count: "desc" } },
      });
      return {
        users,
        nextCursor: users.length === 20 ? users[users.length - 1].id : null,
      };
    }),

  getSuggestions: protectedProcedure.query(async ({ ctx }) => {
    const following = await ctx.prisma.follow.findMany({
      where: { followerId: ctx.session.user.id },
      select: { followingId: true },
    });
    const followingIds = following.map((f) => f.followingId);

    const suggestions = await ctx.prisma.user.findMany({
      where: {
        id: { notIn: [...followingIds, ctx.session.user.id] },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        _count: { select: { followers: true } },
      },
      take: 5,
      orderBy: { followers: { _count: "desc" } },
    });
    return suggestions;
  }),
});
