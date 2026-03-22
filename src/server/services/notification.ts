import type { NotificationType } from "@prisma/client";
import { log } from "@/lib/logger";
import { prisma } from "../db";
import { incrUnreadCount } from "../redis";

/**
 * Notification service
 *
 * Creates notifications with self-suppression and deduplication.
 * Per I6: NEVER create notifications where recipientId === actorId.
 */

export interface CreateNotificationInput {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  tweetId?: string;
  dedupeKey?: string;
}

/**
 * createNotification
 *
 * Creates a notification record with:
 * - Self-suppression (I6): if recipientId === actorId, return early
 * - Deduplication: if dedupeKey provided and duplicate, skip silently
 * - Redis unread count increment
 * - SSE event publishing (best-effort, post-commit)
 *
 * @returns The created notification or null if suppressed/deduplicated
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<{ id: string } | null> {
  const { recipientId, actorId, type, tweetId, dedupeKey } = input;

  // Self-suppression (I6): no self-notifications
  if (recipientId === actorId) {
    return null;
  }

  try {
    // Attempt to create notification
    const notification = await prisma.notification.create({
      data: {
        recipientId,
        actorId,
        type,
        tweetId,
        dedupeKey,
      },
      select: { id: true },
    });

    // Increment Redis unread count (fail-open)
    await incrUnreadCount(recipientId);

    // Log notification creation
    log.info("Notification created", {
      notificationId: notification.id,
      recipientId,
      actorId,
      type,
      tweetId,
    });

    // TODO (E1): Publish SSE 'notification' event to recipient
    // This will be implemented in Phase E when SSE publisher is available

    return notification;
  } catch (error) {
    // Prisma P2002: unique constraint violation on dedupeKey
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      // Silently skip duplicate notification
      return null;
    }

    // Re-throw unexpected errors
    throw error;
  }
}
