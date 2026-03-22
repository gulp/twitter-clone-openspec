"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Composer } from "@/components/Composer";
import { TweetCard } from "@/components/TweetCard";

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const { data, fetchNextPage, hasNextPage, isLoading } =
    trpc.feed.home.useInfiniteQuery(
      {},
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: !!session,
      }
    );

  if (status === "loading" || !session) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-twitter-blue" />
      </div>
    );
  }

  const tweets = data?.pages.flatMap((page) => page.tweets) ?? [];

  return (
    <div>
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-twitter-border">
        <h1 className="font-bold text-xl px-4 py-3 text-twitter-text-light">
          Home
        </h1>
      </div>

      <Composer onSuccess={() => utils.feed.home.invalidate()} />

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-twitter-blue" />
        </div>
      ) : tweets.length === 0 ? (
        <div className="text-center py-12 text-twitter-text-gray">
          <p className="text-2xl font-bold text-twitter-text-light mb-2">
            Welcome to Twitter Clone!
          </p>
          <p>Follow some people to see tweets in your feed.</p>
        </div>
      ) : (
        <>
          {tweets.map((tweet) => (
            <TweetCard
              key={tweet.id}
              tweet={tweet}
              onDelete={() => utils.feed.home.invalidate()}
            />
          ))}
          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              className="w-full py-4 text-twitter-blue hover:bg-white/[0.03] transition-colors"
            >
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
