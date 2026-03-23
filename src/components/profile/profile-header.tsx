"use client";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { EditProfileModal } from "./edit-profile-modal";

export interface ProfileHeaderProps {
  user: {
    id: string;
    username: string;
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    followerCount: number;
    followingCount: number;
    tweetCount: number;
    createdAt: Date;
    isFollowing?: boolean;
  };
  onFollowChange?: () => void;
}

export function ProfileHeader({ user, onFollowChange }: ProfileHeaderProps) {
  const { data: session } = useSession();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [bannerError, setBannerError] = useState(false);
  const utils = trpc.useUtils();

  const followMutation = trpc.social.follow.useMutation({
    onSuccess: () => {
      utils.user.getByUsername.invalidate({ username: user.username });
      utils.social.getFollowers.invalidate();
      utils.social.getFollowing.invalidate();
      onFollowChange?.();
    },
  });

  const unfollowMutation = trpc.social.unfollow.useMutation({
    onSuccess: () => {
      utils.user.getByUsername.invalidate({ username: user.username });
      utils.social.getFollowers.invalidate();
      utils.social.getFollowing.invalidate();
      onFollowChange?.();
    },
  });

  const isOwnProfile = session?.user?.id === user.id;
  const isFollowing = user.isFollowing ?? false;
  const isLoading = followMutation.isPending || unfollowMutation.isPending;

  const handleFollowClick = () => {
    if (isFollowing) {
      unfollowMutation.mutate({ userId: user.id });
    } else {
      followMutation.mutate({ userId: user.id });
    }
  };

  return (
    <>
      <div className="relative">
        {/* Banner Image - Hero Moment */}
        <div className="relative h-48 md:h-64 bg-gradient-to-br from-[#1a2634] via-[#15202B] to-[#0f1419] overflow-hidden">
          {user.bannerUrl && !bannerError ? (
            <img
              src={user.bannerUrl}
              alt="Profile banner"
              onError={() => setBannerError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-[#1DA1F2]/20 via-transparent to-transparent" />
          )}

          {/* Gradient overlay for depth */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#15202B]/60" />
        </div>

        {/* Profile Content */}
        <div className="px-4 pb-4">
          {/* Avatar - Overlapping banner */}
          <div className="flex justify-between items-start mb-4">
            <div className="relative -mt-16 md:-mt-20">
              <div className="relative ring-4 ring-[#15202B] rounded-full overflow-hidden">
                <Avatar
                  src={user.avatarUrl}
                  alt={user.displayName}
                  size="lg"
                  className="w-28 h-28 md:w-32 md:h-32"
                />
              </div>
            </div>

            {/* Action Button */}
            <div className="mt-3">
              {isOwnProfile ? (
                <Button
                  variant="outline"
                  onClick={() => setIsEditModalOpen(true)}
                  className="bg-transparent border-[#536471] text-[#E7E9EA] hover:bg-[#1d2935] font-bold rounded-full px-6 transition-all duration-200"
                >
                  Edit profile
                </Button>
              ) : (
                <Button
                  variant={isFollowing ? "outline" : "primary"}
                  onClick={handleFollowClick}
                  loading={isLoading}
                  className={
                    isFollowing
                      ? "bg-transparent border-[#536471] text-[#E7E9EA] hover:bg-[#39090d] hover:border-[#67070f] hover:text-[#f4212e] font-bold rounded-full px-6 group transition-all duration-200"
                      : "bg-[#E7E9EA] text-[#0F1419] hover:bg-[#d7d9db] font-bold rounded-full px-6 transition-all duration-200"
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
          </div>

          {/* User Info */}
          <div className="mb-3">
            <h1 className="text-[#E7E9EA] text-xl md:text-2xl font-manrope font-bold tracking-tight leading-tight">
              {user.displayName}
            </h1>
            <p className="text-[#71767B] text-[15px] mt-0.5">@{user.username}</p>
          </div>

          {/* Bio */}
          {user.bio && (
            <p className="text-[#E7E9EA] text-[15px] leading-relaxed mb-3 whitespace-pre-wrap break-words">
              {user.bio}
            </p>
          )}

          {/* Join Date */}
          <div className="flex items-center gap-1 mb-3 text-[#71767B] text-[15px]">
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 4V3h2v1h6V3h2v1h1.5C19.89 4 21 5.12 21 6.5v12c0 1.38-1.11 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-12C3 5.12 4.12 4 5.5 4H7zm0 2H5.5c-.27 0-.5.22-.5.5v12c0 .28.23.5.5.5h13c.28 0 .5-.22.5-.5v-12c0-.28-.22-.5-.5-.5H17v1h-2V6H9v1H7V6zm0 6h2v-2H7v2zm0 4h2v-2H7v2zm4-4h2v-2h-2v2zm0 4h2v-2h-2v2zm4-4h2v-2h-2v2z" />
            </svg>
            <span>Joined {formatDate(user.createdAt, "monthYear")}</span>
          </div>

          {/* Stats - Data as Art */}
          <div className="flex gap-5 text-[15px]">
            <a
              href={`/${user.username}/following`}
              className="group flex items-baseline gap-1 hover:underline transition-all duration-200"
            >
              <span className="font-manrope font-bold text-[#E7E9EA] tabular-nums tracking-tight">
                {user.followingCount.toLocaleString()}
              </span>
              <span className="text-[#71767B] group-hover:text-[#E7E9EA] transition-colors duration-200">
                Following
              </span>
            </a>
            <a
              href={`/${user.username}/followers`}
              className="group flex items-baseline gap-1 hover:underline transition-all duration-200"
            >
              <span className="font-manrope font-bold text-[#E7E9EA] tabular-nums tracking-tight">
                {user.followerCount.toLocaleString()}
              </span>
              <span className="text-[#71767B] group-hover:text-[#E7E9EA] transition-colors duration-200">
                Followers
              </span>
            </a>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {isOwnProfile && (
        <EditProfileModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          user={user}
        />
      )}
    </>
  );
}
