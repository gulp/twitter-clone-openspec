"use client";

import { cn } from "@/lib/utils";
import { Bell, Home, Search, User } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

/**
 * Sidebar navigation — Home, Search, Notifications, Profile
 *
 * Features:
 * - Active route highlighting with glow effect
 * - Notification badge (shows unread count)
 * - Compose tweet button with hover glow
 * - Responsive: hidden on mobile, visible on lg+
 */
export function SidebarNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const username = session?.user?.username;

  // Navigation items with active state detection
  const navItems = useMemo(() => {
    return [
      {
        href: "/home",
        label: "Home",
        icon: Home,
        isActive: pathname === "/home",
      },
      {
        href: "/search",
        label: "Search",
        icon: Search,
        isActive: pathname.startsWith("/search"),
      },
      {
        href: "/notifications",
        label: "Notifications",
        icon: Bell,
        isActive: pathname === "/notifications",
        showBadge: false, // TODO: Connect to unread count
      },
      {
        href: username ? `/${username}` : "/profile",
        label: "Profile",
        icon: User,
        isActive: username ? pathname.startsWith(`/${username}`) : false,
      },
    ];
  }, [pathname, username]);

  return (
    <nav className="flex h-full flex-col px-3 py-4">
      {/* Logo */}
      <div className="mb-6 px-3">
        <Link
          href="/home"
          className="inline-flex items-center justify-center w-12 h-12 rounded-full transition-colors hover:bg-[rgb(var(--color-bg-secondary))]"
          aria-label="Home"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7 fill-[rgb(var(--color-text-primary))]"
            aria-hidden="true"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </Link>
      </div>

      {/* Navigation links */}
      <ul className="flex flex-col gap-1 mb-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-4 px-4 py-3 rounded-full text-xl font-medium transition-all duration-200",
                  item.isActive
                    ? "text-[rgb(var(--color-text-primary))]"
                    : "text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-bg-secondary))] hover:text-[rgb(var(--color-text-primary))]"
                )}
                aria-current={item.isActive ? "page" : undefined}
              >
                {/* Active glow effect */}
                {item.isActive && (
                  <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[rgb(var(--color-brand)/0.1)] to-transparent blur-sm" />
                )}

                {/* Icon */}
                <div className="relative">
                  <Icon
                    className={cn(
                      "h-6 w-6 transition-transform duration-200 group-hover:scale-110",
                      item.isActive ? "stroke-[2.5]" : "stroke-[2]"
                    )}
                    aria-hidden="true"
                  />

                  {/* Notification badge */}
                  {item.showBadge && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--color-brand))] text-[10px] font-bold text-white">
                      3
                    </span>
                  )}
                </div>

                {/* Label */}
                <span className="relative">{item.label}</span>

                {/* Active indicator */}
                {item.isActive && (
                  <div className="absolute bottom-2 left-4 h-0.5 w-6 rounded-full bg-[rgb(var(--color-brand))] shadow-[0_0_8px_rgb(var(--color-brand)/0.5)]" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Compose tweet button */}
      <div className="mb-4 px-3">
        <Link
          href="/compose/tweet"
          className="compose-glow flex w-full items-center justify-center gap-2 rounded-full bg-[rgb(var(--color-brand))] px-6 py-3.5 text-lg font-bold text-white transition-all duration-200 hover:bg-[rgb(var(--color-brand-hover))] active:scale-95"
          aria-label="Compose tweet"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
            <path d="M23 3c-6.62-.1-10.38 2.421-13.05 6.03C7.29 12.61 6 17.331 6 22h2c0-1.007.07-2.012.19-3H12c4.1 0 7.48-3.082 7.94-7.054C22.79 10.147 23.17 6.359 23 3zm-7 8h-1.5v2H16c.63-.016 1.2-.08 1.72-.188C16.95 15.24 14.68 17 12 17H8.55c.57-2.512 1.57-4.851 3-6.78 2.16-2.912 5.29-4.911 9.45-5.187C20.95 8.079 19.9 11 16 11zM4 9V6H1V4h3V1h2v3h3v2H6v3H4z" />
          </svg>
          <span className="hidden xl:inline">Tweet</span>
        </Link>
      </div>

      {/* User menu (bottom) */}
      {session?.user && (
        <div className="mt-auto px-3">
          <button
            className="group flex w-full items-center gap-3 rounded-full p-3 transition-all duration-200 hover:bg-[rgb(var(--color-bg-secondary))]"
            aria-label="Account menu"
          >
            {/* Avatar */}
            <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[rgb(var(--color-bg-tertiary))] ring-2 ring-transparent transition-all duration-200 group-hover:ring-[rgb(var(--color-brand)/0.3)]">
              {session.user.avatarUrl ? (
                <img
                  src={session.user.avatarUrl}
                  alt={session.user.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[rgb(var(--color-brand))] to-[rgb(var(--color-brand-hover))] text-white text-sm font-bold">
                  {session.user.displayName?.charAt(0).toUpperCase() || "U"}
                </div>
              )}
            </div>

            {/* User info */}
            <div className="hidden xl:block flex-1 overflow-hidden text-left">
              <p className="truncate text-sm font-semibold text-[rgb(var(--color-text-primary))]">
                {session.user.displayName}
              </p>
              <p className="truncate text-sm text-[rgb(var(--color-text-secondary))]">
                @{session.user.username}
              </p>
            </div>

            {/* More icon */}
            <svg
              viewBox="0 0 24 24"
              className="hidden xl:block h-5 w-5 fill-[rgb(var(--color-text-secondary))]"
              aria-hidden="true"
            >
              <path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
            </svg>
          </button>
        </div>
      )}
    </nav>
  );
}
