"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { trpc } from "@/lib/trpc";

export function Sidebar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const { data: unreadCount } = trpc.notification.unreadCount.useQuery(
    undefined,
    { enabled: !!session, refetchInterval: 30000 }
  );

  const navItems = [
    {
      href: "/home",
      label: "Home",
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      href: "/search",
      label: "Search",
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
    },
    {
      href: "/notifications",
      label: "Notifications",
      badge: unreadCount || 0,
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
    },
    ...(session
      ? [
          {
            href: `/${session.user.username}`,
            label: "Profile",
            icon: (
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col h-full justify-between py-2 px-3">
      <div>
        <Link href="/home" className="block p-3 mb-2">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-twitter-text-light fill-current">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </Link>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 px-4 py-3 rounded-full hover:bg-twitter-dark-secondary transition-colors text-xl ${
                pathname === item.href
                  ? "font-bold text-twitter-text-light"
                  : "text-twitter-text-light"
              }`}
            >
              <div className="relative">
                {item.icon}
                {item.badge ? (
                  <span className="absolute -top-1 -right-1 bg-twitter-blue text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                ) : null}
              </div>
              <span className="hidden xl:block">{item.label}</span>
            </Link>
          ))}
        </nav>

        {session && (
          <Link
            href="/compose"
            className="mt-4 block w-full bg-twitter-blue hover:bg-twitter-blue-hover text-white font-bold rounded-full py-3 text-center text-lg transition-colors"
          >
            <span className="hidden xl:inline">Post</span>
            <span className="xl:hidden text-2xl">+</span>
          </Link>
        )}
      </div>

      {session && (
        <button
          onClick={() => signOut()}
          className="flex items-center gap-3 p-3 rounded-full hover:bg-twitter-dark-secondary transition-colors w-full"
        >
          <div className="w-10 h-10 rounded-full bg-twitter-dark-secondary flex items-center justify-center font-bold">
            {session.user.name?.[0]?.toUpperCase() || "?"}
          </div>
          <div className="hidden xl:block text-left flex-1 min-w-0">
            <p className="font-bold text-sm text-twitter-text-light truncate">
              {session.user.name}
            </p>
            <p className="text-sm text-twitter-text-gray truncate">
              @{session.user.username}
            </p>
          </div>
        </button>
      )}
    </div>
  );
}
