"use client";

import { Avatar } from "@/components/ui/avatar";
import { InfiniteScroll } from "@/components/ui/infinite-scroll";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { FollowButton } from "./follow-button";

export interface UserListUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  isFollowing?: boolean;
}

export interface UserListProps {
  users: UserListUser[];
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
  showFollowButton?: boolean;
}

/**
 * Reusable paginated user list component.
 *
 * Used by:
 * - Followers/following pages
 * - Search results (people tab)
 * - Likers modal
 *
 * Features:
 * - Avatar, display name, username, bio
 * - Follow button (optional)
 * - Infinite scroll pagination
 * - Loading skeletons
 * - Empty state
 */
export function UserList({
  users,
  isLoading = false,
  hasMore = false,
  onLoadMore,
  emptyMessage = "No users found.",
  showFollowButton = true,
}: UserListProps) {
  if (isLoading && users.length === 0) {
    return (
      <div className="divide-y divide-[#38444d]">
        {Array.from({ length: 5 }).map((_, i) => (
          <UserListItemSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <p className="text-[#71767B] text-lg">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <InfiniteScroll
      onLoadMore={onLoadMore || (() => {})}
      hasMore={hasMore}
      className="divide-y divide-[#38444d]"
    >
      {users.map((user) => (
        <UserListItem key={user.id} user={user} showFollowButton={showFollowButton} />
      ))}
      {isLoading && <UserListItemSkeleton />}
    </InfiniteScroll>
  );
}

function UserListItem({
  user,
  showFollowButton,
}: {
  user: UserListUser;
  showFollowButton: boolean;
}) {
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

          {/* Follow button */}
          {showFollowButton && (
            <div className="flex-shrink-0">
              <FollowButton
                userId={user.id}
                initialIsFollowing={user.isFollowing}
                variant="compact"
              />
            </div>
          )}
        </div>

        {/* Bio */}
        {user.bio && (
          <p className="text-[#E7E9EA] text-sm line-clamp-2 mb-2 leading-relaxed">
            {user.bio}
          </p>
        )}
      </div>
    </article>
  );
}

function UserListItemSkeleton() {
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
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
