"use client";

import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useSSE } from "@/hooks/use-sse";
import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Bell icon with unread count badge for sidebar navigation
 *
 * Features:
 * - Shows unread notification count from Redis cache
 * - Real-time updates via SSE hook
 * - Red badge with count when unread notifications exist
 * - Active state highlighting when on notifications page
 * - Auto-refreshes count when new notification arrives
 */

export function NotificationBell() {
  const pathname = usePathname();
  const isActive = pathname === "/notifications";

  // Get unread count from tRPC
  const { data: unreadData, refetch } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 30000, // Cache for 30s
  });

  // Listen for real-time notifications via SSE
  const { latestNotification } = useSSE();

  // Refetch unread count when new notification arrives
  useEffect(() => {
    if (latestNotification) {
      refetch();
    }
  }, [latestNotification, refetch]);

  const unreadCount = unreadData?.count ?? 0;

  return (
    <Link
      href="/notifications"
      className={cn(
        "group relative flex items-center gap-4 px-4 py-3 rounded-full text-xl font-medium transition-all duration-200",
        isActive
          ? "text-[rgb(var(--color-text-primary))]"
          : "text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-bg-secondary))] hover:text-[rgb(var(--color-text-primary))]"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      {/* Active glow effect */}
      {isActive && (
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[rgb(var(--color-brand)/0.1)] to-transparent blur-sm" />
      )}

      {/* Icon with badge */}
      <div className="relative">
        <Bell
          className={cn(
            "h-6 w-6 transition-transform duration-200 group-hover:scale-110",
            isActive ? "stroke-[2.5]" : "stroke-[2]"
          )}
          aria-hidden="true"
        />

        {/* Unread count badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[rgb(var(--color-brand))] px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </div>

      {/* Label */}
      <span className="relative">Notifications</span>

      {/* Active indicator */}
      {isActive && (
        <div className="absolute bottom-2 left-4 h-0.5 w-6 rounded-full bg-[rgb(var(--color-brand))] shadow-[0_0_8px_rgb(var(--color-brand)/0.5)]" />
      )}
    </Link>
  );
}
