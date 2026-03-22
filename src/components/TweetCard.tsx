"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useState } from "react";

type TweetData = {
  id: string;
  content: string;
  createdAt: Date;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
  };
  _count: { likes: number; retweets: number; replies: number };
  liked: boolean;
  retweeted: boolean;
  quoteTweet?: {
    id: string;
    content: string;
    author: {
      username: string;
      displayName: string;
      avatarUrl: string;
    };
  } | null;
};

export function TweetCard({
  tweet,
  onDelete,
}: {
  tweet: TweetData;
  onDelete?: () => void;
}) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const [liked, setLiked] = useState(tweet.liked);
  const [likeCount, setLikeCount] = useState(tweet._count.likes);
  const [retweeted, setRetweeted] = useState(tweet.retweeted);
  const [retweetCount, setRetweetCount] = useState(tweet._count.retweets);

  const likeMutation = trpc.social.like.useMutation({
    onMutate: () => {
      setLiked(true);
      setLikeCount((c) => c + 1);
    },
    onError: () => {
      setLiked(false);
      setLikeCount((c) => c - 1);
    },
  });

  const unlikeMutation = trpc.social.unlike.useMutation({
    onMutate: () => {
      setLiked(false);
      setLikeCount((c) => c - 1);
    },
    onError: () => {
      setLiked(true);
      setLikeCount((c) => c + 1);
    },
  });

  const retweetMutation = trpc.social.retweet.useMutation({
    onMutate: () => {
      setRetweeted(true);
      setRetweetCount((c) => c + 1);
    },
    onError: () => {
      setRetweeted(false);
      setRetweetCount((c) => c - 1);
    },
  });

  const unretweetMutation = trpc.social.unretweet.useMutation({
    onMutate: () => {
      setRetweeted(false);
      setRetweetCount((c) => c - 1);
    },
    onError: () => {
      setRetweeted(true);
      setRetweetCount((c) => c + 1);
    },
  });

  const deleteMutation = trpc.tweet.delete.useMutation({
    onSuccess: () => onDelete?.(),
  });

  const handleLike = () => {
    if (!session) return;
    if (liked) {
      unlikeMutation.mutate({ tweetId: tweet.id });
    } else {
      likeMutation.mutate({ tweetId: tweet.id });
    }
  };

  const handleRetweet = () => {
    if (!session) return;
    if (retweeted) {
      unretweetMutation.mutate({ tweetId: tweet.id });
    } else {
      retweetMutation.mutate({ tweetId: tweet.id });
    }
  };

  const timeAgo = getTimeAgo(new Date(tweet.createdAt));
  const isOwn = session?.user?.id === tweet.author.id;

  return (
    <div className="border-b border-twitter-border px-4 py-3 hover:bg-white/[0.03] transition-colors">
      <div className="flex gap-3">
        <Link href={`/${tweet.author.username}`} className="shrink-0">
          <div className="w-10 h-10 rounded-full bg-twitter-dark-secondary flex items-center justify-center text-lg font-bold">
            {tweet.author.avatarUrl ? (
              <img
                src={tweet.author.avatarUrl}
                className="w-10 h-10 rounded-full object-cover"
                alt=""
              />
            ) : (
              tweet.author.displayName[0]?.toUpperCase()
            )}
          </div>
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-sm">
            <Link
              href={`/${tweet.author.username}`}
              className="font-bold text-twitter-text-light hover:underline truncate"
            >
              {tweet.author.displayName}
            </Link>
            <Link
              href={`/${tweet.author.username}`}
              className="text-twitter-text-gray truncate"
            >
              @{tweet.author.username}
            </Link>
            <span className="text-twitter-text-gray">·</span>
            <Link
              href={`/tweet/${tweet.id}`}
              className="text-twitter-text-gray hover:underline whitespace-nowrap"
            >
              {timeAgo}
            </Link>
            {isOwn && (
              <button
                onClick={() => deleteMutation.mutate({ id: tweet.id })}
                className="ml-auto text-twitter-text-gray hover:text-red-500 text-xs"
              >
                Delete
              </button>
            )}
          </div>

          <Link href={`/tweet/${tweet.id}`}>
            <p className="text-twitter-text-light mt-1 whitespace-pre-wrap break-words">
              {formatContent(tweet.content)}
            </p>
          </Link>

          {tweet.quoteTweet && (
            <Link
              href={`/tweet/${tweet.quoteTweet.id}`}
              className="mt-2 block border border-twitter-border rounded-xl p-3 hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-1 text-sm">
                <span className="font-bold text-twitter-text-light">
                  {tweet.quoteTweet.author.displayName}
                </span>
                <span className="text-twitter-text-gray">
                  @{tweet.quoteTweet.author.username}
                </span>
              </div>
              <p className="text-twitter-text-light text-sm mt-1">
                {tweet.quoteTweet.content}
              </p>
            </Link>
          )}

          <div className="flex items-center gap-8 mt-3 text-sm text-twitter-text-gray">
            <Link
              href={`/tweet/${tweet.id}`}
              className="flex items-center gap-1.5 hover:text-twitter-blue group"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <span>{tweet._count.replies}</span>
            </Link>

            <button
              onClick={handleRetweet}
              className={`flex items-center gap-1.5 hover:text-green-500 ${
                retweeted ? "text-green-500" : ""
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 4l5 5H6v6h6v-3l5 5-5 5v-3H4V4zm16 16l-5-5h3V9h-6v3L7 7l5-5v3h8v16z"
                />
              </svg>
              <span>{retweetCount}</span>
            </button>

            <button
              onClick={handleLike}
              className={`flex items-center gap-1.5 hover:text-pink-500 ${
                liked ? "text-pink-500" : ""
              }`}
            >
              <svg
                className="w-4 h-4"
                fill={liked ? "currentColor" : "none"}
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
              <span>{likeCount}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatContent(content: string) {
  return content;
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
