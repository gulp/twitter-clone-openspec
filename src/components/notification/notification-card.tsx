"use client";

import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { Heart, MessageCircle, Repeat2, User, AtSign, Quote } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Notification card — individual notification with type-specific icon
 *
 * Displays:
 * - Type icon (heart for LIKE, retweet for RETWEET, person for FOLLOW, etc.)
 * - Actor info (avatar, display name, username)
 * - Tweet content preview (if applicable)
 * - Timestamp
 * - Unread visual indicator
 *
 * On click: marks as read and navigates to context
 */

interface NotificationCardProps {
  notification: {
    id: string;
    type: "LIKE" | "RETWEET" | "FOLLOW" | "REPLY" | "MENTION" | "QUOTE_TWEET";
    read: boolean;
    createdAt: string | Date;
    actor: {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
    };
    tweet?: {
      id: string;
      content: string;
      deleted: boolean;
    } | null;
  };
}

const notificationConfig = {
  LIKE: {
    icon: Heart,
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
    message: (actor: string) => `${actor} liked your tweet`,
  },
  RETWEET: {
    icon: Repeat2,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    message: (actor: string) => `${actor} retweeted your tweet`,
  },
  FOLLOW: {
    icon: User,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    message: (actor: string) => `${actor} followed you`,
  },
  REPLY: {
    icon: MessageCircle,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    message: (actor: string) => `${actor} replied to your tweet`,
  },
  MENTION: {
    icon: AtSign,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    message: (actor: string) => `${actor} mentioned you`,
  },
  QUOTE_TWEET: {
    icon: Quote,
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
    message: (actor: string) => `${actor} quoted your tweet`,
  },
} as const;

export function NotificationCard({ notification }: NotificationCardProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      // Invalidate queries to update unread count and notification list
      utils.notification.unreadCount.invalidate();
      utils.notification.list.invalidate();
    },
  });

  const config = notificationConfig[notification.type];
  const Icon = config.icon;

  const handleClick = async () => {
    // Mark as read if unread
    if (!notification.read) {
      markReadMutation.mutate({ id: notification.id });
    }

    // Navigate to context
    if (notification.type === "FOLLOW") {
      // Navigate to actor's profile
      router.push(`/${notification.actor.username}`);
    } else if (notification.tweet && !notification.tweet.deleted) {
      // Navigate to tweet detail page
      router.push(`/${notification.actor.username}/status/${notification.tweet.id}`);
    } else if (!notification.tweet) {
      // Follow notification without tweet - go to actor profile
      router.push(`/${notification.actor.username}`);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "relative px-4 py-3 border-b border-[#38444d] cursor-pointer transition-colors hover:bg-[rgb(var(--color-bg-secondary))]",
        !notification.read && "bg-[#1e3a5f]/20"
      )}
    >
      {/* Unread indicator */}
      {!notification.read && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[rgb(var(--color-brand))]" />
      )}

      <div className="flex gap-3">
        {/* Icon */}
        <div className={cn("flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center", config.bgColor)}>
          <Icon className={cn("w-5 h-5", config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Actor info */}
          <div className="flex items-center gap-2 mb-1">
            <Avatar src={notification.actor.avatarUrl} alt={notification.actor.displayName} size="sm" />
            <div className="flex items-center gap-1 min-w-0">
              <Link
                href={`/${notification.actor.username}`}
                onClick={(e) => e.stopPropagation()}
                className="font-semibold text-[rgb(var(--color-text-primary))] hover:underline truncate"
              >
                {notification.actor.displayName}
              </Link>
              <span className="text-[rgb(var(--color-text-secondary))] text-sm">
                @{notification.actor.username}
              </span>
            </div>
          </div>

          {/* Message */}
          <p className="text-[rgb(var(--color-text-secondary))] text-sm mb-1">
            {config.message(notification.actor.displayName)}
          </p>

          {/* Tweet preview (if applicable) */}
          {notification.tweet && !notification.tweet.deleted && (
            <div className="mt-2 p-2 rounded border border-[#38444d] bg-[rgb(var(--color-bg-tertiary))]">
              <p className="text-[rgb(var(--color-text-primary))] text-sm line-clamp-2">
                {notification.tweet.content}
              </p>
            </div>
          )}

          {/* Deleted tweet indicator */}
          {notification.tweet?.deleted && (
            <div className="mt-2 p-2 rounded border border-[#38444d] bg-[rgb(var(--color-bg-tertiary))]">
              <p className="text-[rgb(var(--color-text-secondary))] text-sm italic">
                This tweet has been deleted
              </p>
            </div>
          )}

          {/* Timestamp */}
          <p className="text-[rgb(var(--color-text-secondary))] text-xs mt-1">
            {formatDate(notification.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
