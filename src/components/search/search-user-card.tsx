"use client";

import { Avatar } from "@/components/ui/avatar";
import { FollowButton } from "@/components/social/follow-button";
import Link from "next/link";

export interface SearchUserCardProps {
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    followerCount: number;
  };
}

/**
 * User card for search results
 *
 * Displays:
 * - Avatar with link to profile
 * - Display name and username with link to profile
 * - Bio (truncated if long)
 * - Follower count
 * - Follow button
 */
export function SearchUserCard({ user }: SearchUserCardProps) {
  return (
    <article className="border-b border-[#38444d] px-4 py-3 hover:bg-[#192734]/30 transition-colors">
      <div className="flex gap-3">
        {/* Avatar */}
        <Link href={`/${user.username}`} className="flex-shrink-0">
          <Avatar src={user.avatarUrl} alt={user.displayName} size="md" />
        </Link>

        {/* User info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0 flex-1">
              {/* Display name */}
              <Link
                href={`/${user.username}`}
                className="font-manrope font-bold text-[#E7E9EA] hover:underline block truncate"
              >
                {user.displayName}
              </Link>
              {/* Username */}
              <Link
                href={`/${user.username}`}
                className="text-[#71767B] text-sm block truncate"
              >
                @{user.username}
              </Link>
            </div>

            {/* Follow button */}
            <FollowButton userId={user.id} variant="compact" />
          </div>

          {/* Bio */}
          {user.bio && (
            <p className="text-[#E7E9EA] text-sm mb-2 line-clamp-2 break-words">
              {user.bio}
            </p>
          )}

          {/* Follower count */}
          <div className="text-[#71767B] text-sm">
            <span className="font-bold text-[#E7E9EA]">
              {user.followerCount.toLocaleString()}
            </span>{" "}
            {user.followerCount === 1 ? "Follower" : "Followers"}
          </div>
        </div>
      </div>
    </article>
  );
}
