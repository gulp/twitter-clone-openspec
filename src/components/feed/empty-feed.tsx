"use client";

import Link from "next/link";

/**
 * Empty feed state
 *
 * Displayed when user has no tweets in their home timeline
 * (typically when they don't follow anyone yet).
 *
 * Suggests following users to populate the feed.
 */
export function EmptyFeed() {
  return (
    <div className="px-8 py-16 text-center">
      <div className="max-w-md mx-auto space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-full bg-[#1DA1F2]/10 flex items-center justify-center">
            <svg className="w-12 h-12 text-[#1DA1F2]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082.593 1.85 2.313 3.198 4.352 3.234-1.595 1.25-3.604 1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z" />
            </svg>
          </div>
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h2 className="text-[#E7E9EA] font-manrope font-bold text-2xl">
            Welcome to your timeline!
          </h2>
          <p className="text-[#71767B] text-base leading-relaxed">
            Your home feed is empty because you're not following anyone yet. Follow some users to
            see their tweets here.
          </p>
        </div>

        {/* CTA */}
        <div>
          <Link
            href="/search"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#1DA1F2] text-[#0F1419] font-manrope font-bold rounded-full transition-all hover:bg-[#1a8cd8] active:scale-95"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z" />
            </svg>
            Find people to follow
          </Link>
        </div>
      </div>
    </div>
  );
}
