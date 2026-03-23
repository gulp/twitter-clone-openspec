"use client";

import { trpc } from "@/lib/trpc";
import { Heart, MessageCircle, Repeat2, Share } from "lucide-react";
import { useEffect, useState } from "react";
import { Dropdown } from "../ui/dropdown";
import { cn } from "../ui/utils";

export interface EngagementButtonsProps {
  tweetId: string;
  authorUsername?: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  hasLiked?: boolean;
  hasRetweeted?: boolean;
  onReply?: () => void;
  className?: string;
}

export function EngagementButtons({
  tweetId,
  authorUsername,
  likeCount: initialLikeCount,
  retweetCount: initialRetweetCount,
  replyCount,
  hasLiked: initialHasLiked = false,
  hasRetweeted: initialHasRetweeted = false,
  onReply,
  className,
}: EngagementButtonsProps) {
  // Optimistic state — sync from server when props change (e.g. after query invalidation)
  const [hasLiked, setHasLiked] = useState(initialHasLiked);
  const [hasRetweeted, setHasRetweeted] = useState(initialHasRetweeted);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [retweetCount, setRetweetCount] = useState(initialRetweetCount);

  useEffect(() => {
    setHasLiked(initialHasLiked);
  }, [initialHasLiked]);
  useEffect(() => {
    setHasRetweeted(initialHasRetweeted);
  }, [initialHasRetweeted]);
  useEffect(() => {
    setLikeCount(initialLikeCount);
  }, [initialLikeCount]);
  useEffect(() => {
    setRetweetCount(initialRetweetCount);
  }, [initialRetweetCount]);

  const utils = trpc.useUtils();

  // Mutations
  const likeMutation = trpc.engagement.like.useMutation({
    onMutate: async () => {
      // Optimistic update
      setHasLiked(true);
      setLikeCount((prev) => prev + 1);
    },
    onError: () => {
      // Rollback on error
      setHasLiked(false);
      setLikeCount((prev) => prev - 1);
    },
    onSuccess: () => {
      // Invalidate tweet queries to sync engagement counts
      utils.feed.home.invalidate();
      utils.tweet.getById.invalidate({ tweetId });
      utils.tweet.getReplies.invalidate({ tweetId });
    },
  });

  const unlikeMutation = trpc.engagement.unlike.useMutation({
    onMutate: async () => {
      // Optimistic update
      setHasLiked(false);
      setLikeCount((prev) => prev - 1);
    },
    onError: () => {
      // Rollback on error
      setHasLiked(true);
      setLikeCount((prev) => prev + 1);
    },
    onSuccess: () => {
      // Invalidate tweet queries to sync engagement counts
      utils.feed.home.invalidate();
      utils.tweet.getById.invalidate({ tweetId });
      utils.tweet.getReplies.invalidate({ tweetId });
    },
  });

  const retweetMutation = trpc.engagement.retweet.useMutation({
    onMutate: async () => {
      // Optimistic update
      setHasRetweeted(true);
      setRetweetCount((prev) => prev + 1);
    },
    onError: () => {
      // Rollback on error
      setHasRetweeted(false);
      setRetweetCount((prev) => prev - 1);
    },
    onSuccess: () => {
      // Invalidate tweet queries to sync engagement counts
      utils.feed.home.invalidate();
      utils.tweet.getById.invalidate({ tweetId });
      utils.tweet.getReplies.invalidate({ tweetId });
    },
  });

  const undoRetweetMutation = trpc.engagement.undoRetweet.useMutation({
    onMutate: async () => {
      // Optimistic update
      setHasRetweeted(false);
      setRetweetCount((prev) => prev - 1);
    },
    onError: () => {
      // Rollback on error
      setHasRetweeted(true);
      setRetweetCount((prev) => prev + 1);
    },
    onSuccess: () => {
      // Invalidate tweet queries to sync engagement counts
      utils.feed.home.invalidate();
      utils.tweet.getById.invalidate({ tweetId });
      utils.tweet.getReplies.invalidate({ tweetId });
    },
  });

  const handleLike = () => {
    if (likeMutation.isPending || unlikeMutation.isPending) return;
    if (hasLiked) {
      unlikeMutation.mutate({ tweetId });
    } else {
      likeMutation.mutate({ tweetId });
    }
  };

  const handleRetweet = () => {
    if (retweetMutation.isPending || undoRetweetMutation.isPending) return;
    if (hasRetweeted) {
      undoRetweetMutation.mutate({ tweetId });
    } else {
      retweetMutation.mutate({ tweetId });
    }
  };

  const handleQuoteTweet = () => {
    // TODO: Open quote tweet composer modal
    console.log("Quote tweet:", tweetId);
  };

  const handleShare = async () => {
    if (!authorUsername) {
      console.error("Cannot share tweet: authorUsername is missing", { tweetId });
      return;
    }

    const url = `${window.location.origin}/${authorUsername}/status/${tweetId}`;

    if (navigator.share) {
      try {
        await navigator.share({ url });
      } catch (err) {
        // User cancelled or error (AbortError is expected when user cancels)
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("Share failed:", err.message);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        // TODO: Show toast notification
      } catch (err) {
        console.warn("Clipboard write failed:", err instanceof Error ? err.message : String(err));
      }
    }
  };

  return (
    <div className={cn("flex items-center justify-between max-w-md", className)}>
      {/* Reply */}
      <button
        type="button"
        onClick={onReply}
        className="group flex items-center gap-2 text-gray-400 hover:text-blue-400 transition-colors"
        aria-label={`Reply (${replyCount} replies)`}
      >
        <div className="rounded-full p-2 group-hover:bg-blue-400/10 transition-colors">
          <MessageCircle className="w-[18px] h-[18px]" />
        </div>
        {replyCount > 0 && <span className="text-sm font-medium tabular-nums">{replyCount}</span>}
      </button>

      {/* Retweet */}
      <Dropdown
        trigger={
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 transition-colors",
              hasRetweeted ? "text-green-500" : "text-gray-400 hover:text-green-500"
            )}
            aria-label={`Retweet (${retweetCount} retweets)`}
          >
            <div
              className={cn(
                "rounded-full p-2 transition-colors",
                hasRetweeted ? "bg-green-500/10" : "group-hover:bg-green-500/10"
              )}
            >
              <Repeat2 className="w-[18px] h-[18px]" />
            </div>
            {retweetCount > 0 && (
              <span className="text-sm font-medium tabular-nums">{retweetCount}</span>
            )}
          </button>
        }
        items={[
          {
            id: "retweet",
            label: hasRetweeted ? "Undo Retweet" : "Retweet",
            onClick: handleRetweet,
          },
          {
            id: "quote",
            label: "Quote Tweet",
            onClick: handleQuoteTweet,
          },
        ]}
      />

      {/* Like */}
      <button
        type="button"
        onClick={handleLike}
        className={cn(
          "group flex items-center gap-2 transition-all duration-200",
          hasLiked ? "text-rose-500" : "text-gray-400 hover:text-rose-500"
        )}
        aria-label={`Like (${likeCount} likes)`}
        aria-pressed={hasLiked}
      >
        <div
          className={cn(
            "rounded-full p-2 transition-all duration-200",
            hasLiked
              ? "bg-rose-500/10 scale-110"
              : "group-hover:bg-rose-500/10 group-hover:scale-105"
          )}
        >
          <Heart
            className={cn(
              "w-[18px] h-[18px] transition-all duration-200",
              hasLiked && "fill-current"
            )}
          />
        </div>
        {likeCount > 0 && <span className="text-sm font-medium tabular-nums">{likeCount}</span>}
      </button>

      {/* Share */}
      <button
        type="button"
        onClick={handleShare}
        className="group flex items-center gap-2 text-gray-400 hover:text-blue-400 transition-colors"
        aria-label="Share"
      >
        <div className="rounded-full p-2 group-hover:bg-blue-400/10 transition-colors">
          <Share className="w-[18px] h-[18px]" />
        </div>
      </button>
    </div>
  );
}
