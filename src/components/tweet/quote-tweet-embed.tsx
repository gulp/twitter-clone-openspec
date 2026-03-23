"use client";

import { Avatar } from "@/components/ui/avatar";
import Link from "next/link";
import { useState } from "react";

export interface QuoteTweetEmbedProps {
  tweet: {
    id: string;
    content: string;
    author: {
      username: string;
      displayName: string;
      avatarUrl: string | null;
    };
    mediaUrls?: string[];
  };
}

export function QuoteTweetEmbed({ tweet }: QuoteTweetEmbedProps) {
  const [mediaError, setMediaError] = useState(false);
  return (
    <Link
      href={`/${tweet.author.username}/status/${tweet.id}`}
      className="block border border-[#38444d] rounded-2xl p-3 transition-colors hover:bg-[#192734]/30"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Author info */}
      <div className="flex items-center gap-2 mb-2">
        <Avatar src={tweet.author.avatarUrl} alt={tweet.author.displayName} size="sm" />
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-manrope font-bold text-[#E7E9EA] text-sm truncate">
            {tweet.author.displayName}
          </span>
          <span className="text-[#71767B] text-sm truncate">@{tweet.author.username}</span>
        </div>
      </div>

      {/* Content preview */}
      {tweet.content && (
        <p className="text-[#E7E9EA] text-sm mb-2 line-clamp-3 leading-relaxed">{tweet.content}</p>
      )}

      {/* Media thumbnail (first image only) */}
      {tweet.mediaUrls && tweet.mediaUrls.length > 0 && !mediaError && (
        <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-[#192734]">
          <img
            src={tweet.mediaUrls[0]}
            alt="Quoted tweet media"
            onError={() => setMediaError(true)}
            className="w-full h-full object-cover"
          />
          {tweet.mediaUrls.length > 1 && (
            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-md font-mono">
              +{tweet.mediaUrls.length - 1}
            </div>
          )}
        </div>
      )}
    </Link>
  );
}
