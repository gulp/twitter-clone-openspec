"use client";

import { TweetCard } from "@/components/tweet/tweet-card";
import { InfiniteScroll } from "@/components/ui/infinite-scroll";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export interface ProfileTabsProps {
  userId: string;
}

type TabId = "tweets" | "replies" | "likes";

export function ProfileTabs({ userId }: ProfileTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("tweets");

  // Tweets tab
  const tweetsQuery = trpc.tweet.getUserTweets.useInfiniteQuery(
    { userId, limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: activeTab === "tweets",
    }
  );

  // Replies tab
  const repliesQuery = trpc.tweet.getUserReplies.useInfiniteQuery(
    { userId, limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: activeTab === "replies",
    }
  );

  // Likes tab
  const likesQuery = trpc.engagement.getUserLikes.useInfiniteQuery(
    { userId, limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: activeTab === "likes",
    }
  );

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "tweets", label: "Tweets" },
    { id: "replies", label: "Replies" },
    { id: "likes", label: "Likes" },
  ];

  const renderContent = () => {
    const query = { tweets: tweetsQuery, replies: repliesQuery, likes: likesQuery }[activeTab];

    if (query.isLoading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#1DA1F2] border-t-transparent" />
        </div>
      );
    }

    if (query.isError) {
      return (
        <div className="text-center py-16">
          <p className="text-[#71767B] text-[15px]">Failed to load {activeTab}</p>
        </div>
      );
    }

    const tweets = query.data?.pages.flatMap((page) => page.items) ?? [];

    if (tweets.length === 0) {
      return (
        <div className="text-center py-16 px-4">
          <h3 className="text-[#E7E9EA] text-[31px] font-manrope font-bold mb-2">
            {activeTab === "tweets" && "No tweets yet"}
            {activeTab === "replies" && "No replies yet"}
            {activeTab === "likes" && "No likes yet"}
          </h3>
          <p className="text-[#71767B] text-[15px] max-w-md mx-auto">
            {activeTab === "tweets" && "When they tweet, it will show up here."}
            {activeTab === "replies" && "When they reply to tweets, it will show up here."}
            {activeTab === "likes" && "When they like a tweet, it will show up here."}
          </p>
        </div>
      );
    }

    return (
      <InfiniteScroll
        hasMore={query.hasNextPage ?? false}
        onLoadMore={() => query.fetchNextPage()}
        loading={query.isFetchingNextPage}
      >
        <div>
          {tweets.map((tweet) => (
            <TweetCard
              key={tweet.id}
              tweet={tweet}
              hasLiked={tweet.hasLiked ?? false}
              hasRetweeted={tweet.hasRetweeted ?? false}
            />
          ))}
        </div>
      </InfiniteScroll>
    );
  };

  return (
    <div>
      {/* Tab Navigation - Surgical precision */}
      <div className="border-b border-[#2f3336]">
        <nav className="flex" aria-label="Profile tabs">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="relative flex-1 py-4 text-center font-manrope font-bold text-[15px] transition-colors duration-200 hover:bg-[#1d2935]/50 focus:outline-none focus-visible:bg-[#1d2935]/50"
                aria-current={isActive ? "page" : undefined}
              >
                <span
                  className={isActive ? "text-[#E7E9EA]" : "text-[#71767B] hover:text-[#E7E9EA]"}
                >
                  {tab.label}
                </span>

                {/* Active indicator - Surgical blue accent */}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#1DA1F2] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div>{renderContent()}</div>
    </div>
  );
}
