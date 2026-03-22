"use client";

import { Avatar } from "@/components/ui/avatar";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageGrid } from "../media/image-grid";
import { EngagementButtons } from "./engagement-buttons";
import { QuoteTweetEmbed } from "./quote-tweet-embed";

export interface TweetCardProps {
  tweet: {
    id: string;
    content: string;
    createdAt: Date;
    likeCount: number;
    retweetCount: number;
    replyCount: number;
    mediaUrls?: string[];
    quoteTweetId?: string | null;
    author: {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      verified?: boolean;
    };
    quotedTweet?: {
      id: string;
      content: string;
      author: {
        username: string;
        displayName: string;
        avatarUrl: string | null;
      };
      mediaUrls?: string[];
    } | null;
  };
  hasLiked?: boolean;
  hasRetweeted?: boolean;
  showParentLine?: boolean;
  onClick?: () => void;
}

export function TweetCard({
  tweet,
  hasLiked = false,
  hasRetweeted = false,
  showParentLine = false,
  onClick,
}: TweetCardProps) {
  const router = useRouter();

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest('[role="button"]')) {
      return;
    }

    if (onClick) {
      onClick();
    } else {
      router.push(`/${tweet.author.username}/status/${tweet.id}`);
    }
  };

  return (
    <article
      className="relative border-b border-[#38444d] px-4 py-3 transition-colors hover:bg-[#192734]/30 cursor-pointer"
      onClick={handleCardClick}
    >
      {/* Parent thread line */}
      {showParentLine && <div className="absolute left-[34px] top-0 bottom-0 w-0.5 bg-[#38444d]" />}

      <div className="flex gap-3">
        {/* Avatar */}
        <Link
          href={`/${tweet.author.username}`}
          className="flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Avatar src={tweet.author.avatarUrl} alt={tweet.author.displayName} size="md" />
        </Link>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Author info */}
          <div className="flex items-center gap-1 mb-0.5">
            <Link
              href={`/${tweet.author.username}`}
              className="font-manrope font-bold text-[#E7E9EA] hover:underline truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {tweet.author.displayName}
            </Link>
            {tweet.author.verified && (
              <svg
                className="w-4 h-4 text-[#1DA1F2] flex-shrink-0"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
              </svg>
            )}
            <span className="text-[#71767B] truncate">@{tweet.author.username}</span>
            <span className="text-[#71767B]">·</span>
            <time
              className="text-[#71767B] text-sm whitespace-nowrap"
              dateTime={tweet.createdAt.toISOString()}
            >
              {formatDate(tweet.createdAt)}
            </time>
          </div>

          {/* Tweet content */}
          {tweet.content && (
            <p className="text-[#E7E9EA] whitespace-pre-wrap break-words mb-3 leading-relaxed">
              {tweet.content}
            </p>
          )}

          {/* Media grid */}
          {tweet.mediaUrls && tweet.mediaUrls.length > 0 && (
            <div className="mb-3">
              <ImageGrid images={tweet.mediaUrls} />
            </div>
          )}

          {/* Quoted tweet */}
          {tweet.quotedTweet && (
            <div className="mb-3">
              <QuoteTweetEmbed tweet={tweet.quotedTweet} />
            </div>
          )}

          {/* Engagement buttons */}
          <EngagementButtons
            tweetId={tweet.id}
            replyCount={tweet.replyCount}
            retweetCount={tweet.retweetCount}
            likeCount={tweet.likeCount}
            hasLiked={hasLiked}
            hasRetweeted={hasRetweeted}
          />
        </div>
      </div>
    </article>
  );
}
