"use client";

import { trpc } from "@/lib/trpc";
import { Search } from "lucide-react";
import Link from "next/link";

/**
 * Right sidebar — Search, Trending, Who to Follow
 *
 * Features:
 * - Sticky search bar (links to /search)
 * - Trending topics placeholder
 * - Who to Follow widget using getSuggestions
 * - Refined card surfaces with subtle borders
 * - Loading states with skeletons
 */
export function RightSidebar() {
  return (
    <div className="flex flex-col gap-4 px-4 py-2">
      {/* Search bar */}
      <SearchBar />

      {/* Trending topics (placeholder for now) */}
      <TrendingWidget />

      {/* Who to follow */}
      <WhoToFollowWidget />
    </div>
  );
}

/**
 * Search bar — links to /search page
 */
function SearchBar() {
  return (
    <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg-primary))] py-2">
      <Link
        href="/search"
        className="group flex items-center gap-3 rounded-full bg-[rgb(var(--color-bg-secondary))] px-4 py-3 transition-all duration-200 hover:bg-[rgb(var(--color-bg-tertiary))] focus-within:ring-2 focus-within:ring-[rgb(var(--color-brand))]"
        aria-label="Search"
      >
        <Search
          className="h-5 w-5 text-[rgb(var(--color-text-tertiary))] transition-colors group-hover:text-[rgb(var(--color-text-secondary))]"
          aria-hidden="true"
        />
        <span className="text-[15px] text-[rgb(var(--color-text-tertiary))] transition-colors group-hover:text-[rgb(var(--color-text-secondary))]">
          Search
        </span>
      </Link>
    </div>
  );
}

/**
 * Trending widget — placeholder for trending topics
 */
function TrendingWidget() {
  // Mock trending data (replace with real data later)
  const trendingTopics = [
    { category: "Technology", topic: "Next.js 15", tweets: "12.5K" },
    { category: "Programming", topic: "TypeScript", tweets: "8.3K" },
    { category: "Web Dev", topic: "React Server Components", tweets: "5.1K" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl bg-[rgb(var(--color-bg-secondary))] border border-[rgb(var(--color-border-primary)/0.3)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[rgb(var(--color-border-primary)/0.3)]">
        <h2 className="text-xl font-bold text-[rgb(var(--color-text-primary))]">
          Trending
        </h2>
      </div>

      {/* Trending items */}
      <div className="divide-y divide-[rgb(var(--color-border-primary)/0.3)]">
        {trendingTopics.map((item, index) => (
          <button
            key={index}
            className="w-full px-4 py-3 text-left transition-colors duration-150 hover:bg-[rgb(var(--color-bg-tertiary))]"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-[13px] text-[rgb(var(--color-text-tertiary))]">
                  {item.category} · Trending
                </p>
                <p className="mt-0.5 text-[15px] font-bold text-[rgb(var(--color-text-primary))]">
                  {item.topic}
                </p>
                <p className="mt-0.5 text-[13px] text-[rgb(var(--color-text-tertiary))]">
                  {item.tweets} posts
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Show more */}
      <Link
        href="/search"
        className="block px-4 py-3 text-[15px] text-[rgb(var(--color-brand))] hover:bg-[rgb(var(--color-bg-tertiary))] transition-colors duration-150"
      >
        Show more
      </Link>
    </div>
  );
}

/**
 * Who to Follow widget — uses tRPC getSuggestions
 */
function WhoToFollowWidget() {
  const { data: suggestions, isLoading } = trpc.social.getSuggestions.useQuery();
  const followMutation = trpc.social.follow.useMutation();

  const handleFollow = async (userId: string) => {
    try {
      await followMutation.mutateAsync({ userId });
    } catch (error) {
      console.error("Follow error:", error);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-[rgb(var(--color-bg-secondary))] border border-[rgb(var(--color-border-primary)/0.3)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[rgb(var(--color-border-primary)/0.3)]">
        <h2 className="text-xl font-bold text-[rgb(var(--color-text-primary))]">
          Who to follow
        </h2>
      </div>

      {/* Suggestions list */}
      <div className="divide-y divide-[rgb(var(--color-border-primary)/0.3)]">
        {isLoading ? (
          // Loading skeletons
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                  <div className="flex-1">
                    <div className="h-4 w-24 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                    <div className="mt-1 h-3 w-16 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                  </div>
                  <div className="h-8 w-20 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                </div>
              </div>
            ))}
          </>
        ) : suggestions && suggestions.length > 0 ? (
          suggestions.slice(0, 3).map((user: typeof suggestions[0]) => (
            <div
              key={user.id}
              className="px-4 py-3 transition-colors duration-150 hover:bg-[rgb(var(--color-bg-tertiary))]"
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <Link href={`/${user.username}`} className="flex-shrink-0">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.displayName}
                      className="h-12 w-12 rounded-full object-cover ring-2 ring-transparent transition-all hover:ring-[rgb(var(--color-brand)/0.3)]"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[rgb(var(--color-brand))] to-[rgb(var(--color-brand-hover))] text-white font-bold">
                      {user.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </Link>

                {/* User info */}
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/${user.username}`}
                    className="group block"
                  >
                    <p className="truncate text-[15px] font-bold text-[rgb(var(--color-text-primary))] group-hover:underline">
                      {user.displayName}
                    </p>
                    <p className="truncate text-[13px] text-[rgb(var(--color-text-tertiary))]">
                      @{user.username}
                    </p>
                  </Link>
                  {user.bio && (
                    <p className="mt-1 line-clamp-2 text-[13px] text-[rgb(var(--color-text-secondary))]">
                      {user.bio}
                    </p>
                  )}
                </div>

                {/* Follow button */}
                <button
                  onClick={() => handleFollow(user.id)}
                  disabled={followMutation.isPending}
                  className="flex-shrink-0 rounded-full bg-[rgb(var(--color-text-primary))] px-4 py-1.5 text-[14px] font-bold text-[rgb(var(--color-bg-primary))] transition-all duration-150 hover:bg-[rgb(var(--color-text-secondary))] active:scale-95 disabled:opacity-50"
                  aria-label={`Follow ${user.displayName}`}
                >
                  Follow
                </button>
              </div>
            </div>
          ))
        ) : (
          // Empty state
          <div className="px-4 py-6 text-center">
            <p className="text-[15px] text-[rgb(var(--color-text-tertiary))]">
              No suggestions available
            </p>
          </div>
        )}
      </div>

      {/* Show more */}
      {suggestions && suggestions.length > 3 && (
        <Link
          href="/search?tab=people"
          className="block px-4 py-3 text-[15px] text-[rgb(var(--color-brand))] hover:bg-[rgb(var(--color-bg-tertiary))] transition-colors duration-150"
        >
          Show more
        </Link>
      )}
    </div>
  );
}
