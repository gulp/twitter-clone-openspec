"use client";

import { EmptyFeed } from "@/components/feed/empty-feed";
import { FeedList } from "@/components/feed/feed-list";
import { NewTweetsIndicator } from "@/components/feed/new-tweets-indicator";
import { TweetComposer } from "@/components/tweet/tweet-composer";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Home feed page
 *
 * Authenticated-only page showing:
 * - Tweet composer at top
 * - New tweets indicator (SSE-driven)
 * - Feed of tweets from followed users
 * - Empty state if not following anyone
 *
 * Protected by NextAuth session - redirects to login if unauthenticated.
 */
export default function HomePage() {
  const { status } = useSession();
  const router = useRouter();
  const utils = trpc.useUtils();
  const feedContainerRef = useRef<HTMLDivElement>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Get feed data using infinite query
  const {
    data: feedData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = trpc.feed.home.useInfiniteQuery(
    { limit: 20 },
    {
      enabled: status === "authenticated",
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  const handleShowNewTweets = () => {
    // Scroll to top
    if (feedContainerRef.current) {
      feedContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Invalidate feed to refetch and show new tweets
    utils.feed.home.invalidate();
  };

  const handleTweetSuccess = () => {
    // Invalidate feed to show the newly created tweet
    utils.feed.home.invalidate();
  };

  // Loading state during authentication check
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0F1419]">
        <div className="sticky top-0 z-10 backdrop-blur-md bg-[#0F1419]/80 border-b border-[#38444d]">
          <div className="px-4 py-3">
            <h1 className="text-[#E7E9EA] font-manrope font-bold text-xl">Home</h1>
          </div>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (status !== "authenticated") {
    return null;
  }

  const isEmpty =
    !isLoading && (!feedData?.pages[0]?.items || feedData.pages[0].items.length === 0);

  return (
    <div ref={feedContainerRef} className="min-h-screen bg-[#0F1419]">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-[#0F1419]/80 border-b border-[#38444d]">
        <div className="px-4 py-3">
          <h1 className="text-[#E7E9EA] font-manrope font-bold text-xl">Home</h1>
        </div>
      </div>

      {/* Tweet composer */}
      <TweetComposer placeholder="What's happening?" onSuccess={handleTweetSuccess} />

      {/* New tweets indicator */}
      <NewTweetsIndicator onShowNewTweets={handleShowNewTweets} />

      {/* Feed content */}
      {isEmpty ? (
        <EmptyFeed />
      ) : (
        <FeedList
          data={feedData}
          fetchNextPage={fetchNextPage}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isLoading={isLoading}
          isError={isError}
          error={error}
        />
      )}
    </div>
  );
}
