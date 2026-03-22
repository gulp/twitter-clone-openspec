"use client";

import { NotificationCard } from "@/components/notification/notification-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { trpc } from "@/lib/trpc";
import { Bell } from "lucide-react";

/**
 * Notifications page
 *
 * Features:
 * - Paginated notification list with infinite scroll
 * - Mark all read button
 * - Individual notification click marks as read and navigates
 * - Empty state when no notifications
 * - Loading and error states
 */

export default function NotificationsPage() {
  const utils = trpc.useUtils();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error } =
    trpc.notification.list.useInfiniteQuery(
      { limit: 20 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    );

  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      // Invalidate queries to update UI
      utils.notification.unreadCount.invalidate();
      utils.notification.list.invalidate();
    },
  });

  const sentinelRef = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, hasNextPage && !isFetchingNextPage);

  // Loading state
  if (isLoading) {
    return (
      <div>
        {/* Header */}
        <div className="sticky top-0 z-10 backdrop-blur-md bg-[rgb(var(--color-bg-primary))]/80 border-b border-[#38444d]">
          <div className="px-4 py-3">
            <h1 className="text-xl font-bold text-[rgb(var(--color-text-primary))]">Notifications</h1>
          </div>
        </div>

        {/* Loading skeletons */}
        <div className="divide-y divide-[#38444d]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex gap-3">
                <Skeleton className="w-10 h-10 rounded-full bg-[#38444d]" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <Skeleton className="w-8 h-8 rounded-full bg-[#38444d]" />
                    <Skeleton className="h-4 w-32 bg-[#38444d]" />
                  </div>
                  <Skeleton className="h-12 w-full bg-[#38444d]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div>
        {/* Header */}
        <div className="sticky top-0 z-10 backdrop-blur-md bg-[rgb(var(--color-bg-primary))]/80 border-b border-[#38444d]">
          <div className="px-4 py-3">
            <h1 className="text-xl font-bold text-[rgb(var(--color-text-primary))]">Notifications</h1>
          </div>
        </div>

        {/* Error message */}
        <div className="px-4 py-8 text-center">
          <p className="text-[#F91880] font-manrope">{error?.message || "Failed to load notifications"}</p>
        </div>
      </div>
    );
  }

  // Flatten pages into single notification list
  const notifications = data?.pages.flatMap((page) => page.items) ?? [];

  // Check if there are unread notifications
  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div>
      {/* Header with Mark all read button */}
      <div className="sticky top-0 z-10 backdrop-blur-md bg-[rgb(var(--color-bg-primary))]/80 border-b border-[#38444d]">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-[rgb(var(--color-text-primary))]">Notifications</h1>
          {hasUnread && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              loading={markAllReadMutation.isLoading}
              className="text-[rgb(var(--color-brand))] hover:text-[rgb(var(--color-brand-hover))]"
            >
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {notifications.length === 0 && (
        <div className="px-8 py-16 text-center">
          <div className="max-w-md mx-auto space-y-6">
            {/* Icon */}
            <div className="flex justify-center">
              <div className="w-24 h-24 rounded-full bg-[rgb(var(--color-brand))]/10 flex items-center justify-center">
                <Bell className="w-12 h-12 text-[rgb(var(--color-brand))]" />
              </div>
            </div>

            {/* Message */}
            <div className="space-y-2">
              <h2 className="text-[rgb(var(--color-text-primary))] font-manrope font-bold text-2xl">
                No notifications yet
              </h2>
              <p className="text-[rgb(var(--color-text-secondary))] text-base leading-relaxed">
                When someone likes, retweets, replies to, or mentions you in a tweet, you'll see it here.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Notification list */}
      {notifications.length > 0 && (
        <div>
          {notifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={{
                ...notification,
                createdAt: new Date(notification.createdAt),
              }}
            />
          ))}

          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} className="w-full py-4">
            {isFetchingNextPage && (
              <div className="px-4">
                <div className="flex gap-3">
                  <Skeleton className="w-10 h-10 rounded-full bg-[#38444d]" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32 bg-[#38444d]" />
                    <Skeleton className="h-12 w-full bg-[#38444d]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
