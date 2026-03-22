"use client";

import { TweetCard } from "@/components/tweet/tweet-card";
import { TweetComposer } from "@/components/tweet/tweet-composer";
import { EngagementButtons } from "@/components/tweet/engagement-buttons";
import { trpc } from "@/lib/trpc";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useCallback } from "react";

export default function TweetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const tweetId = params.tweetId as string;

  // Fetch main tweet
  const {
    data: tweet,
    isLoading,
    isError,
  } = trpc.tweet.getById.useQuery({ tweetId });

  // Fetch parent tweet if this is a reply
  const {
    data: parentTweet,
    isLoading: parentLoading,
  } = trpc.tweet.getById.useQuery(
    { tweetId: tweet?.parentId ?? "" },
    { enabled: !!tweet?.parentId }
  );

  // Fetch replies with infinite scroll
  const {
    data: repliesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = trpc.tweet.getReplies.useInfiniteQuery(
    { tweetId, limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  // Infinite scroll observer
  const observerTarget = useRef<HTMLDivElement>(null);

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    const element = observerTarget.current;
    if (!element) return;

    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "100px",
      threshold: 0.1,
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [handleObserver]);

  // Loading state
  if (isLoading || (tweet?.parentId && parentLoading)) {
    return (
      <div className="min-h-screen bg-[#15202B] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-[#1DA1F2] border-t-transparent" />
      </div>
    );
  }

  // Error/404 state
  if (isError || !tweet) {
    return (
      <div className="min-h-screen bg-[#15202B] flex flex-col items-center justify-center px-4">
        <h1 className="text-[31px] font-manrope font-bold text-[#E7E9EA] mb-2">
          This post doesn't exist
        </h1>
        <p className="text-[#71767B] text-[15px] mb-6">
          Try searching for something else.
        </p>
        <button
          onClick={() => router.back()}
          className="text-[#1DA1F2] hover:underline font-bold"
        >
          Go back
        </button>
      </div>
    );
  }

  const replies = repliesData?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="min-h-screen bg-[#15202B]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#15202B]/80 backdrop-blur-md border-b border-[#2f3336]">
        <div className="px-4 py-3 flex items-center gap-8">
          <button
            onClick={() => router.back()}
            className="text-[#E7E9EA] hover:bg-[#192734] rounded-full p-2 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z" />
            </svg>
          </button>
          <h1 className="text-xl font-manrope font-bold text-[#E7E9EA]">Post</h1>
        </div>
      </div>

      {/* Parent tweet (if reply) */}
      {parentTweet && (
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-[50px] top-0 bottom-0 w-0.5 bg-[#38444d]" />
          <TweetCard
            tweet={parentTweet}
            hasLiked={parentTweet.hasLiked}
            hasRetweeted={parentTweet.hasRetweeted}
            onClick={() =>
              router.push(`/${parentTweet.author.username}/status/${parentTweet.id}`)
            }
          />
        </div>
      )}

      {/* Main tweet */}
      <article className="border-b border-[#38444d] px-4 py-3">
        <div className="flex gap-3 mb-3">
          <button
            onClick={() => router.push(`/${tweet.author.username}`)}
            className="flex-shrink-0"
          >
            <div className="w-12 h-12 rounded-full bg-[#38444d] overflow-hidden">
              {tweet.author.avatarUrl ? (
                <img
                  src={tweet.author.avatarUrl}
                  alt={tweet.author.displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#E7E9EA] font-bold">
                  {tweet.author.displayName[0]?.toUpperCase()}
                </div>
              )}
            </div>
          </button>

          <div className="flex-1 min-w-0">
            <button
              onClick={() => router.push(`/${tweet.author.username}`)}
              className="font-manrope font-bold text-[#E7E9EA] hover:underline"
            >
              {tweet.author.displayName}
            </button>
            <div className="text-[#71767B] text-[15px]">@{tweet.author.username}</div>
          </div>
        </div>

        {/* Tweet content */}
        {tweet.content && (
          <p className="text-[#E7E9EA] text-[23px] leading-relaxed mb-3 whitespace-pre-wrap break-words">
            {tweet.content}
          </p>
        )}

        {/* Media */}
        {tweet.mediaUrls && tweet.mediaUrls.length > 0 && (
          <div className="mb-3">
            <div className="grid grid-cols-2 gap-0.5 rounded-2xl overflow-hidden">
              {tweet.mediaUrls.map((url, index) => (
                <img
                  key={index}
                  src={url}
                  alt=""
                  className="w-full h-auto object-cover"
                />
              ))}
            </div>
          </div>
        )}

        {/* Quote tweet embed */}
        {tweet.quotedTweet && (
          <div className="mb-3">
            <button
              onClick={() =>
                router.push(
                  `/${tweet.quotedTweet!.author.username}/status/${tweet.quotedTweet!.id}`
                )
              }
              className="w-full border border-[#38444d] rounded-2xl p-3 hover:bg-[#192734]/30 transition-colors text-left"
            >
              <div className="flex items-center gap-1 mb-1">
                {tweet.quotedTweet.author.avatarUrl && (
                  <div className="w-5 h-5 rounded-full overflow-hidden">
                    <img
                      src={tweet.quotedTweet.author.avatarUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <span className="font-bold text-[#E7E9EA] text-sm">
                  {tweet.quotedTweet.author.displayName}
                </span>
                <span className="text-[#71767B] text-sm">
                  @{tweet.quotedTweet.author.username}
                </span>
              </div>
              {tweet.quotedTweet.content && (
                <p className="text-[#E7E9EA] text-[15px] mb-2 whitespace-pre-wrap break-words">
                  {tweet.quotedTweet.content}
                </p>
              )}
              {tweet.quotedTweet.mediaUrls && tweet.quotedTweet.mediaUrls.length > 0 && (
                <div className="grid grid-cols-2 gap-0.5 rounded-xl overflow-hidden">
                  {tweet.quotedTweet.mediaUrls.map((url, index) => (
                    <img
                      key={index}
                      src={url}
                      alt=""
                      className="w-full h-auto object-cover"
                    />
                  ))}
                </div>
              )}
            </button>
          </div>
        )}

        {/* Timestamp */}
        <div className="text-[#71767B] text-[15px] mb-4 pb-4 border-b border-[#38444d]">
          {new Date(tweet.createdAt).toLocaleString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>

        {/* Engagement counts */}
        {(tweet.retweetCount > 0 || tweet.likeCount > 0 || tweet.replyCount > 0) && (
          <div className="flex gap-4 py-4 border-b border-[#38444d] text-[15px]">
            {tweet.retweetCount > 0 && (
              <div>
                <span className="font-bold text-[#E7E9EA]">
                  {tweet.retweetCount.toLocaleString()}
                </span>{" "}
                <span className="text-[#71767B]">
                  {tweet.retweetCount === 1 ? "Retweet" : "Retweets"}
                </span>
              </div>
            )}
            {tweet.likeCount > 0 && (
              <div>
                <span className="font-bold text-[#E7E9EA]">
                  {tweet.likeCount.toLocaleString()}
                </span>{" "}
                <span className="text-[#71767B]">
                  {tweet.likeCount === 1 ? "Like" : "Likes"}
                </span>
              </div>
            )}
            {tweet.replyCount > 0 && (
              <div>
                <span className="font-bold text-[#E7E9EA]">
                  {tweet.replyCount.toLocaleString()}
                </span>{" "}
                <span className="text-[#71767B]">
                  {tweet.replyCount === 1 ? "Reply" : "Replies"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Engagement buttons */}
        <div className="py-2 border-b border-[#38444d]">
          <EngagementButtons
            tweetId={tweet.id}
            replyCount={tweet.replyCount}
            retweetCount={tweet.retweetCount}
            likeCount={tweet.likeCount}
            hasLiked={tweet.hasLiked}
            hasRetweeted={tweet.hasRetweeted}
          />
        </div>
      </article>

      {/* Reply composer */}
      {session && (
        <TweetComposer
          parentId={tweetId}
          placeholder="Post your reply"
          replyToUser={{
            username: tweet.author.username,
            displayName: tweet.author.displayName,
          }}
          autoFocus={false}
        />
      )}

      {/* Replies thread */}
      <div>
        {replies.map((reply) => (
          <TweetCard
            key={reply.id}
            tweet={reply}
            hasLiked={reply.hasLiked}
            hasRetweeted={reply.hasRetweeted}
          />
        ))}

        {/* Infinite scroll trigger */}
        {hasNextPage && <div ref={observerTarget} className="h-20" />}

        {/* Loading more indicator */}
        {isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-[#1DA1F2] border-t-transparent" />
          </div>
        )}

        {/* Empty state */}
        {replies.length === 0 && !isFetchingNextPage && (
          <div className="py-16 text-center text-[#71767B]">
            <p className="text-[31px] font-manrope font-bold mb-2">No replies yet</p>
            <p className="text-[15px]">Be the first to reply.</p>
          </div>
        )}
      </div>
    </div>
  );
}
