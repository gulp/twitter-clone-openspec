"use client";

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { TweetCard } from "@/components/TweetCard";
import Link from "next/link";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tab, setTab] = useState<"tweets" | "people">("tweets");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: tweetResults } = trpc.tweet.search.useInfiniteQuery(
    { query: debouncedQuery },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: debouncedQuery.length > 0 && tab === "tweets",
    }
  );

  const { data: userResults } = trpc.user.search.useInfiniteQuery(
    { query: debouncedQuery },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: debouncedQuery.length > 0 && tab === "people",
    }
  );

  const tweets = tweetResults?.pages.flatMap((p) => p.tweets) ?? [];
  const users = userResults?.pages.flatMap((p) => p.users) ?? [];

  return (
    <div>
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-twitter-border">
        <div className="px-4 py-2">
          <input
            type="text"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-twitter-dark-secondary rounded-full px-4 py-2.5 text-twitter-text-light placeholder-twitter-text-gray focus:outline-none focus:ring-1 focus:ring-twitter-blue"
          />
        </div>
        <div className="flex">
          <button
            onClick={() => setTab("tweets")}
            className={`flex-1 py-3 text-center text-sm font-bold transition-colors relative ${
              tab === "tweets"
                ? "text-twitter-text-light"
                : "text-twitter-text-gray hover:bg-white/[0.03]"
            }`}
          >
            Tweets
            {tab === "tweets" && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-twitter-blue rounded-full" />
            )}
          </button>
          <button
            onClick={() => setTab("people")}
            className={`flex-1 py-3 text-center text-sm font-bold transition-colors relative ${
              tab === "people"
                ? "text-twitter-text-light"
                : "text-twitter-text-gray hover:bg-white/[0.03]"
            }`}
          >
            People
            {tab === "people" && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-twitter-blue rounded-full" />
            )}
          </button>
        </div>
      </div>

      {!debouncedQuery ? (
        <div className="text-center py-12 text-twitter-text-gray">
          Search for tweets or people
        </div>
      ) : tab === "tweets" ? (
        tweets.length === 0 ? (
          <div className="text-center py-12 text-twitter-text-gray">
            No tweets found for &quot;{debouncedQuery}&quot;
          </div>
        ) : (
          tweets.map((tweet) => <TweetCard key={tweet.id} tweet={tweet} />)
        )
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-twitter-text-gray">
          No people found for &quot;{debouncedQuery}&quot;
        </div>
      ) : (
        users.map((user) => (
          <Link
            key={user.id}
            href={`/${user.username}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors border-b border-twitter-border"
          >
            <div className="w-12 h-12 rounded-full bg-twitter-dark-secondary flex items-center justify-center text-lg font-bold shrink-0">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  className="w-12 h-12 rounded-full object-cover"
                  alt=""
                />
              ) : (
                user.displayName[0]?.toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-twitter-text-light truncate">
                {user.displayName}
              </p>
              <p className="text-twitter-text-gray text-sm">
                @{user.username}
              </p>
              {user.bio && (
                <p className="text-twitter-text-light text-sm mt-1 line-clamp-2">
                  {user.bio}
                </p>
              )}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
