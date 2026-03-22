"use client";

import { cn } from "@/lib/utils";
import { Bell, Home, Search, User } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

/**
 * Mobile bottom navigation — fixed tab bar
 *
 * Features:
 * - Shows on mobile/tablet (hidden on lg+)
 * - Active tab highlighted with brand color and glow
 * - Glass morphism backdrop blur effect
 * - Notification badge
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const username = session?.user?.username;

  // Navigation items (same as sidebar but mobile-optimized)
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
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 lg:hidden border-t border-[rgb(var(--color-border-primary)/0.3)] backdrop-blur-xl"
      style={{
        background:
          "linear-gradient(to top, rgb(var(--color-bg-primary)/0.95), rgb(var(--color-bg-primary)/0.9))",
      }}
      aria-label="Mobile navigation"
    >
      <ul className="flex items-center justify-around px-2 py-1 safe-area-inset-bottom">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2 px-3 rounded-lg transition-all duration-200",
                  item.isActive
                    ? "text-[rgb(var(--color-brand))]"
                    : "text-[rgb(var(--color-text-secondary))] active:scale-95"
                )}
                aria-current={item.isActive ? "page" : undefined}
                aria-label={item.label}
              >
                {/* Active glow background */}
                {item.isActive && (
                  <div className="absolute inset-0 rounded-lg bg-[rgb(var(--color-brand)/0.1)] shadow-[0_0_12px_rgb(var(--color-brand)/0.2)]" />
                )}

                {/* Icon with badge */}
                <div className="relative z-10">
                  <Icon
                    className={cn(
                      "h-6 w-6 transition-transform duration-200",
                      item.isActive ? "stroke-[2.5] scale-110" : "stroke-[2]"
                    )}
                    aria-hidden="true"
                  />

                  {/* Notification badge */}
                  {item.showBadge && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--color-brand))] text-[10px] font-bold text-white shadow-lg">
                      3
                    </span>
                  )}
                </div>

                {/* Label (extra small) */}
                <span
                  className={cn(
                    "relative z-10 text-[10px] font-medium transition-all duration-200",
                    item.isActive ? "opacity-100" : "opacity-70"
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
