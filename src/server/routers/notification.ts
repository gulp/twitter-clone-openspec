import { z } from "zod";
import { router, protectedProcedure } from "../trpc";

export const notificationRouter = router({
  list: protectedProcedure
    .input(z.object({ cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const notifications = await ctx.prisma.notification.findMany({
        where: { recipientId: ctx.session.user.id },
        include: {
          actor: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
        take: 20,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });

      return {
        notifications,
        nextCursor:
          notifications.length === 20
            ? notifications[notifications.length - 1].id
            : null,
      };
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.notification.count({
      where: { recipientId: ctx.session.user.id, read: false },
    });
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.notification.update({
        where: { id: input.id },
        data: { read: true },
      });
      return { success: true };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.notification.updateMany({
      where: { recipientId: ctx.session.user.id, read: false },
      data: { read: true },
    });
    return { success: true };
  }),
});
