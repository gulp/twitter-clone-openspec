"use client";

import { TweetCard } from "@/components/tweet/tweet-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import type { AppRouter } from "@/server/trpc/router";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * Feed list component with infinite scroll
 *
 * Renders a paginated list of tweets from the authenticated user's home timeline
 * using cursor-based pagination.
 *
 * Uses IntersectionObserver via useInfiniteScroll hook to auto-load
 * next page when scrolling near the bottom.
 */
interface FeedListProps {
  data:
    | {
        pages: RouterOutputs["feed"]["home"][];
        pageParams: unknown[];
      }
    | undefined;
  fetchNextPage: () => void;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isError: boolean;
  error: TRPCClientErrorLike<AppRouter> | null;
}

export function FeedList({
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  isError,
  error,
}: FeedListProps) {
  const sentinelRef = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, hasNextPage && !isFetchingNextPage);

  // Loading state
  if (isLoading) {
    return (
      <div className="divide-y divide-[#38444d]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex gap-3">
              <Skeleton className="w-12 h-12 rounded-full" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-full" />
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[#F91880] font-manrope">{error?.message || "Failed to load feed"}</p>
      </div>
    );
  }

  // Flatten pages into single tweet list
  const tweets = data?.pages.flatMap((page) => page.items) ?? [];

  // Empty state handled by parent
  if (tweets.length === 0) {
    return null;
  }

  return (
    <div>
      {tweets.map((tweet) => (
        <TweetCard
          key={tweet.id}
          tweet={{
            ...tweet,
            createdAt: new Date(tweet.createdAt),
          }}
          retweetedBy={tweet.retweetedBy}
          hasLiked={tweet.hasLiked}
          hasRetweeted={tweet.hasRetweeted}
        />
      ))}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="w-full py-4">
        {isFetchingNextPage && (
          <div data-testid="loading-more" className="px-4">
            <div className="flex gap-3">
              <Skeleton className="w-12 h-12 rounded-full" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
