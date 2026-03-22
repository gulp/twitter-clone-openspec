"use client";

import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useState } from "react";
import { FollowButton } from "./follow-button";

/**
 * Who To Follow widget for right sidebar.
 *
 * Features:
 * - Shows top 3 follow suggestions from tRPC social.getSuggestions
 * - Suggestions based on mutual connections (users followed by people you follow)
 * - Following a user removes them from the suggestion list (optimistic update)
 * - Authenticated users only (returns null for unauthenticated)
 * - Loading skeletons
 * - "Show more" link to full suggestions page (future)
 */
export function WhoToFollow() {
  const { data: suggestions, isLoading } = trpc.social.getSuggestions.useQuery(undefined, {
    // Don't refetch on mount if we have cached data
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Track locally hidden suggestions (when user follows someone)
  const [hiddenUserIds, setHiddenUserIds] = useState<Set<string>>(new Set());

  // Filter out followed/hidden users, show top 3
  const visibleSuggestions = (suggestions || [])
    .filter((user) => !hiddenUserIds.has(user.id))
    .slice(0, 3);

  // Hide suggestion when user follows them
  const handleFollow = (userId: string) => {
    setHiddenUserIds((prev) => new Set(prev).add(userId));
  };

  if (isLoading) {
    return (
      <div className="bg-[#16181C] rounded-2xl overflow-hidden">
        <h2 className="text-[#E7E9EA] text-xl font-bold px-4 py-3">Who to follow</h2>
        <div className="divide-y divide-[#38444d]">
          {Array.from({ length: 3 }).map((_, i) => (
            <SuggestionSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Don't show if no suggestions
  if (!suggestions || visibleSuggestions.length === 0) {
    return null;
  }

  return (
    <div className="bg-[#16181C] rounded-2xl overflow-hidden">
      <h2 className="text-[#E7E9EA] text-xl font-bold px-4 py-3">Who to follow</h2>

      <div className="divide-y divide-[#38444d]">
        {visibleSuggestions.map((user) => (
          <SuggestionCard key={user.id} user={user} onFollow={handleFollow} />
        ))}
      </div>

      {/* Show more link (future enhancement) */}
      <Link
        href="/explore/people"
        className="block px-4 py-3 text-[#1DA1F2] hover:bg-[#192734]/30 transition-colors"
      >
        Show more
      </Link>
    </div>
  );
}

interface SuggestionCardProps {
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
  };
  onFollow: (userId: string) => void;
}

function SuggestionCard({ user, onFollow }: SuggestionCardProps) {
  const [localIsFollowing, setLocalIsFollowing] = useState(false);

  const handleFollowClick = () => {
    setLocalIsFollowing(true);
    onFollow(user.id);
  };

  return (
    <article className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[#192734]/30">
      {/* Avatar */}
      <Link href={`/${user.username}`} className="flex-shrink-0">
        <Avatar src={user.avatarUrl} alt={user.displayName} size="md" />
      </Link>

      {/* User info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="min-w-0 flex-1">
            <Link
              href={`/${user.username}`}
              className="block font-manrope font-bold text-[#E7E9EA] hover:underline truncate"
            >
              {user.displayName}
            </Link>
            <Link
              href={`/${user.username}`}
              className="block text-[#71767B] text-sm truncate"
            >
              @{user.username}
            </Link>
          </div>

          {/* Follow button - wrapped to trigger onFollow callback */}
          <div className="flex-shrink-0" onClick={handleFollowClick}>
            <FollowButton
              userId={user.id}
              initialIsFollowing={localIsFollowing}
              variant="compact"
            />
          </div>
        </div>

        {/* Bio (truncated to 2 lines) */}
        {user.bio && (
          <p className="text-[#E7E9EA] text-sm line-clamp-2 leading-relaxed">{user.bio}</p>
        )}
      </div>
    </article>
  );
}

function SuggestionSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {/* Avatar skeleton */}
      <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />

      {/* Content skeleton */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <Skeleton className="h-5 w-32 mb-1" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-8 w-20 flex-shrink-0" />
        </div>
        <Skeleton className="h-4 w-full mb-1" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
