"use client";

import { TweetCard } from "@/components/tweet/tweet-card";
import { Tabs } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { SearchUserCard } from "./search-user-card";
import { useRouter, useSearchParams } from "next/navigation";

export interface SearchResultsProps {
  query: string;
}

/**
 * Search results with tab switching (Tweets/People)
 *
 * Features:
 * - Tab switching between Tweets and People
 * - Infinite scroll for both result types
 * - Loading states during search
 * - Empty states for no results
 * - URL persistence for active tab
 */
export function SearchResults({ query }: SearchResultsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = tabParam === "tweets" || tabParam === "people" ? tabParam : "tweets";

  // Fetch tweet results
  const tweetsQuery = trpc.search.tweets.useInfiniteQuery(
    { query, limit: 20 },
    {
      enabled: query.length >= 2 && activeTab === "tweets",
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  // Fetch user results
  const usersQuery = trpc.search.users.useInfiniteQuery(
    { query, limit: 20 },
    {
      enabled: query.length >= 2 && activeTab === "people",
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  // Infinite scroll for tweets
  const tweetsSentinelRef = useInfiniteScroll(
    () => {
      if (tweetsQuery.hasNextPage && !tweetsQuery.isFetchingNextPage) {
        tweetsQuery.fetchNextPage();
      }
    },
    activeTab === "tweets" && tweetsQuery.hasNextPage && !tweetsQuery.isFetchingNextPage,
    0.5,
    "100px"
  );

  // Infinite scroll for users
  const usersSentinelRef = useInfiniteScroll(
    () => {
      if (usersQuery.hasNextPage && !usersQuery.isFetchingNextPage) {
        usersQuery.fetchNextPage();
      }
    },
    activeTab === "people" && usersQuery.hasNextPage && !usersQuery.isFetchingNextPage,
    0.5,
    "100px"
  );

  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tabId);
    if (query) {
      params.set("q", query);
    }
    router.push(`/search?${params.toString()}`);
  };

  // Empty state for short queries
  if (query.length < 2) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-[#71767B] text-center">
          Enter at least 2 characters to search
        </p>
      </div>
    );
  }

  // Flatten paginated results
  const tweets = tweetsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const users = usersQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const tabs = [
    {
      id: "tweets",
      label: "Tweets",
      content: (
        <div>
          {/* Loading state */}
          {tweetsQuery.isLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1DA1F2]" />
            </div>
          )}

          {/* Error state */}
          {tweetsQuery.error && (
            <div className="flex items-center justify-center py-16">
              <p className="text-red-500">
                {tweetsQuery.error.message || "Failed to load tweets"}
              </p>
            </div>
          )}

          {/* Results */}
          {!tweetsQuery.isLoading && !tweetsQuery.error && (
            <>
              {tweets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <svg
                    className="w-16 h-16 text-[#71767B] mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <p className="text-[#E7E9EA] text-xl font-bold mb-2">No tweets found</p>
                  <p className="text-[#71767B] text-center">
                    Try searching for something else
                  </p>
                </div>
              ) : (
                <div>
                  {tweets.map((tweet) => (
                    <TweetCard
                      key={tweet.id}
                      tweet={tweet}
                      hasLiked={tweet.hasLiked}
                      hasRetweeted={tweet.hasRetweeted}
                    />
                  ))}
                  {/* Infinite scroll sentinel */}
                  {tweetsQuery.hasNextPage && (
                    <div ref={tweetsSentinelRef} className="py-8 flex justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#1DA1F2]" />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      id: "people",
      label: "People",
      content: (
        <div>
          {/* Loading state */}
          {usersQuery.isLoading && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1DA1F2]" />
            </div>
          )}

          {/* Error state */}
          {usersQuery.error && (
            <div className="flex items-center justify-center py-16">
              <p className="text-red-500">
                {usersQuery.error.message || "Failed to load users"}
              </p>
            </div>
          )}

          {/* Results */}
          {!usersQuery.isLoading && !usersQuery.error && (
            <>
              {users.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <svg
                    className="w-16 h-16 text-[#71767B] mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  <p className="text-[#E7E9EA] text-xl font-bold mb-2">No people found</p>
                  <p className="text-[#71767B] text-center">
                    Try searching for something else
                  </p>
                </div>
              ) : (
                <div>
                  {users.map((user) => (
                    <SearchUserCard key={user.id} user={user} />
                  ))}
                  {/* Infinite scroll sentinel */}
                  {usersQuery.hasNextPage && (
                    <div ref={usersSentinelRef} className="py-8 flex justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#1DA1F2]" />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return <Tabs tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />;
}
