"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { TweetCard } from "@/components/TweetCard";
import { Composer } from "@/components/Composer";

export default function TweetPage() {
  const params = useParams();
  const id = params.id as string;
  const utils = trpc.useUtils();

  const { data: tweet, isLoading } = trpc.tweet.getById.useQuery({ id });

  const { data: repliesData, fetchNextPage, hasNextPage } =
    trpc.tweet.getReplies.useInfiniteQuery(
      { tweetId: id },
      { getNextPageParam: (lastPage) => lastPage.nextCursor, enabled: !!tweet }
    );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-twitter-blue" />
      </div>
    );
  }

  if (!tweet) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-twitter-text-light">
          Tweet not found
        </h2>
      </div>
    );
  }

  const replies = repliesData?.pages.flatMap((page) => page.replies) ?? [];

  return (
    <div>
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-twitter-border">
        <h1 className="font-bold text-xl px-4 py-3 text-twitter-text-light">
          Post
        </h1>
      </div>

      <TweetCard
        tweet={tweet}
        onDelete={() => window.history.back()}
      />

      <Composer
        parentId={id}
        placeholder="Post your reply"
        onSuccess={() => {
          utils.tweet.getReplies.invalidate({ tweetId: id });
          utils.tweet.getById.invalidate({ id });
        }}
      />

      {replies.map((reply) => (
        <TweetCard
          key={reply.id}
          tweet={reply}
          onDelete={() => utils.tweet.getReplies.invalidate({ tweetId: id })}
        />
      ))}
      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          className="w-full py-4 text-twitter-blue hover:bg-white/[0.03]"
        >
          Load more
        </button>
      )}
    </div>
  );
}
