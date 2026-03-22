import { paginationSchema } from "@/lib/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, publicUserSelect } from "../../db";
import { decrUnreadCount, getUnreadCount, setUnreadCount } from "../../redis";
import { createTRPCRouter, protectedProcedure } from "../index";

/**
 * Notification router
 *
 * Procedures:
 * - list: cursor-paginated notifications with actor and tweet info
 * - unreadCount: Redis-cached unread count with DB fallback
 * - markRead: mark single notification as read, decrement Redis count
 * - markAllRead: mark all notifications as read, reset Redis count
 */
export const notificationRouter = createTRPCRouter({
  /**
   * list — Get paginated notifications for the current user
   *
   * Returns notifications in reverse-chronological order (newest first)
   * with actor user info and tweet content preview.
   */
  list: protectedProcedure.input(paginationSchema).query(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const { cursor, limit } = input;

    const notifications = await prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        actor: { select: publicUserSelect },
        tweet: {
          select: {
            id: true,
            content: true,
            deleted: true,
          },
        },
      },
    });

    let nextCursor: string | null = null;
    if (notifications.length > limit) {
      const nextItem = notifications.pop();
      nextCursor = nextItem?.id ?? null;
    }

    // Redact content of deleted tweets (I5: deleted tweets must not leak content)
    const items = notifications.map((n) => ({
      ...n,
      tweet: n.tweet?.deleted ? { id: n.tweet.id, content: "", deleted: true } : n.tweet,
    }));

    return {
      items,
      nextCursor,
    };
  }),

  /**
   * unreadCount — Get unread notification count
   *
   * Reads from Redis cache with fallback to DB COUNT(*) on cache miss.
   */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Try Redis cache first
    const cachedCount = await getUnreadCount(userId);
    if (cachedCount !== null) {
      return { count: cachedCount };
    }

    // Fallback to DB count
    const dbCount = await prisma.notification.count({
      where: {
        recipientId: userId,
        read: false,
      },
    });

    // Backfill Redis cache
    await setUnreadCount(userId, dbCount);

    return { count: dbCount };
  }),

  /**
   * markRead — Mark a single notification as read
   *
   * Verifies ownership (recipientId === userId) and decrements Redis unread count.
   */
  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { id } = input;

      // Update notification, ensuring it belongs to the user
      const result = await prisma.notification.updateMany({
        where: {
          id,
          recipientId: userId,
          read: false, // Only update if not already read
        },
        data: { read: true },
      });

      // If no rows updated, either not found or already read
      if (result.count === 0) {
        // Check if notification exists and belongs to user
        const notification = await prisma.notification.findUnique({
          where: { id },
          select: { recipientId: true, read: true },
        });

        if (!notification) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Notification not found",
          });
        }

        if (notification.recipientId !== userId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not your notification",
          });
        }

        // Already read, no-op
        return { success: true };
      }

      // Decrement Redis unread count (fail-open)
      await decrUnreadCount(userId);

      return { success: true };
    }),

  /**
   * markAllRead — Mark all unread notifications as read
   *
   * Updates all unread notifications for the user and resets Redis count to 0.
   */
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Update all unread notifications
    await prisma.notification.updateMany({
      where: {
        recipientId: userId,
        read: false,
      },
      data: { read: true },
    });

    // Reset Redis unread count to 0
    await setUnreadCount(userId, 0);

    return { success: true };
  }),
});
