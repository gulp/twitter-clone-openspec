"use client";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InfiniteScroll } from "@/components/ui/infinite-scroll";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import Link from "next/link";

export interface UserListProps {
  userId: string;
  type: "followers" | "following";
}

export function UserList({ userId, type }: UserListProps) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();

  const query =
    type === "followers"
      ? trpc.social.getFollowers.useInfiniteQuery(
          { userId, limit: 20 },
          { getNextPageParam: (lastPage) => lastPage.nextCursor }
        )
      : trpc.social.getFollowing.useInfiniteQuery(
          { userId, limit: 20 },
          { getNextPageParam: (lastPage) => lastPage.nextCursor }
        );

  const followMutation = trpc.social.follow.useMutation({
    onSuccess: () => {
      utils.social.getFollowers.invalidate();
      utils.social.getFollowing.invalidate();
      utils.user.getByUsername.invalidate();
    },
  });

  const unfollowMutation = trpc.social.unfollow.useMutation({
    onSuccess: () => {
      utils.social.getFollowers.invalidate();
      utils.social.getFollowing.invalidate();
      utils.user.getByUsername.invalidate();
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#1DA1F2] border-t-transparent" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="text-center py-16">
        <p className="text-[#71767B] text-[15px]">Failed to load {type}</p>
      </div>
    );
  }

  const users = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (users.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <h3 className="text-[#E7E9EA] text-[31px] font-manrope font-bold mb-2">
          {type === "followers" ? "No followers yet" : "Not following anyone yet"}
        </h3>
        <p className="text-[#71767B] text-[15px] max-w-md mx-auto">
          {type === "followers"
            ? "When someone follows this account, they'll show up here."
            : "When this account follows someone, they'll show up here."}
        </p>
      </div>
    );
  }

  const handleFollowClick = (targetUserId: string, isFollowing: boolean) => {
    if (isFollowing) {
      unfollowMutation.mutate({ userId: targetUserId });
    } else {
      followMutation.mutate({ userId: targetUserId });
    }
  };

  return (
    <InfiniteScroll
      hasMore={query.hasNextPage ?? false}
      onLoadMore={() => query.fetchNextPage()}
      loading={query.isFetchingNextPage}
    >
      <div>
        {users.map((user) => {
          const isOwnProfile = session?.user?.id === user.id;
          // TODO: Fetch isFollowing state from server for each user
          const isFollowing = false;
          const isLoading =
            (followMutation.isPending || unfollowMutation.isPending) &&
            (followMutation.variables?.userId === user.id ||
              unfollowMutation.variables?.userId === user.id);

          return (
            <div
              key={user.id}
              className="border-b border-[#2f3336] px-4 py-3 hover:bg-[#192734]/30 transition-colors duration-200"
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <Link href={`/${user.username}`} className="flex-shrink-0">
                  <Avatar src={user.avatarUrl} alt={user.displayName} size="md" />
                </Link>

                <div className="flex-1 min-w-0">
                  {/* User info */}
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/${user.username}`}
                        className="block hover:underline"
                      >
                        <div className="font-manrope font-bold text-[#E7E9EA] truncate">
                          {user.displayName}
                        </div>
                        <div className="text-[#71767B] text-[15px] truncate">
                          @{user.username}
                        </div>
                      </Link>
                    </div>

                    {/* Follow button */}
                    {!isOwnProfile && session?.user?.id && (
                      <Button
                        variant={isFollowing ? "outline" : "primary"}
                        size="sm"
                        onClick={() => handleFollowClick(user.id, isFollowing)}
                        loading={isLoading}
                        disabled={isLoading}
                        className={
                          isFollowing
                            ? "bg-transparent border-[#536471] text-[#E7E9EA] hover:bg-[#39090d] hover:border-[#67070f] hover:text-[#f4212e] font-bold rounded-full px-4 group transition-all duration-200"
                            : "bg-[#E7E9EA] text-[#0F1419] hover:bg-[#d7d9db] font-bold rounded-full px-4 transition-all duration-200"
                        }
                      >
                        <span className={isFollowing ? "group-hover:hidden" : ""}>
                          {isFollowing ? "Following" : "Follow"}
                        </span>
                        {isFollowing && (
                          <span className="hidden group-hover:inline">Unfollow</span>
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Bio */}
                  {user.bio && (
                    <p className="text-[#E7E9EA] text-[15px] line-clamp-2 mb-2">
                      {user.bio}
                    </p>
                  )}

                  {/* Stats */}
                  <div className="flex gap-4 text-[13px] text-[#71767B]">
                    <span>
                      <span className="font-bold text-[#E7E9EA]">
                        {user.followingCount.toLocaleString()}
                      </span>{" "}
                      Following
                    </span>
                    <span>
                      <span className="font-bold text-[#E7E9EA]">
                        {user.followerCount.toLocaleString()}
                      </span>{" "}
                      Followers
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </InfiniteScroll>
  );
}
