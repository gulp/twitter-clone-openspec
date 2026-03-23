"use client";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useState } from "react";

export interface FollowButtonProps {
  userId: string;
  initialIsFollowing?: boolean;
  variant?: "default" | "compact";
  className?: string;
}

/**
 * Follow/Following toggle button with optimistic updates.
 *
 * Features:
 * - Optimistic UI: immediately toggles state, reverts on error
 * - Shows "Unfollow" on hover when in Following state
 * - Disabled for unauthenticated users
 * - Variant support: default (full size) or compact (smaller)
 */
export function FollowButton({
  userId,
  initialIsFollowing = false,
  variant = "default",
  className,
}: FollowButtonProps) {
  const { data: session } = useSession();
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [isHovered, setIsHovered] = useState(false);

  const utils = trpc.useUtils();

  // Follow mutation with optimistic update
  const followMutation = trpc.social.follow.useMutation({
    onMutate: async () => {
      // Optimistic update
      setIsFollowing(true);
    },
    onError: () => {
      // Rollback on error
      setIsFollowing(false);
    },
    onSuccess: () => {
      // Invalidate relevant queries
      utils.social.getFollowers.invalidate({ userId });
      // Guard against session expiring mid-mutation
      if (session?.user?.id) {
        utils.social.getFollowing.invalidate({ userId: session.user.id });
      }
      utils.social.getSuggestions.invalidate();
    },
  });

  // Unfollow mutation with optimistic update
  const unfollowMutation = trpc.social.unfollow.useMutation({
    onMutate: async () => {
      // Optimistic update
      setIsFollowing(false);
    },
    onError: () => {
      // Rollback on error
      setIsFollowing(true);
    },
    onSuccess: () => {
      // Invalidate relevant queries
      utils.social.getFollowers.invalidate({ userId });
      // Guard against session expiring mid-mutation
      if (session?.user?.id) {
        utils.social.getFollowing.invalidate({ userId: session.user.id });
      }
      utils.social.getSuggestions.invalidate();
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      // TODO: Show login modal or redirect to login
      return;
    }

    if (isFollowing) {
      unfollowMutation.mutate({ userId });
    } else {
      followMutation.mutate({ userId });
    }
  };

  // Don't show button if viewing own profile
  if (session?.user?.id === userId) {
    return null;
  }

  const isLoading = followMutation.isPending || unfollowMutation.isPending;

  // Determine button text based on state and hover
  const getButtonText = () => {
    if (isFollowing) {
      return isHovered ? "Unfollow" : "Following";
    }
    return "Follow";
  };

  return (
    <Button
      variant={isFollowing ? "outline" : "primary"}
      size={variant === "compact" ? "sm" : "md"}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={!session}
      loading={isLoading}
      className={className}
      aria-label={isFollowing ? "Unfollow user" : "Follow user"}
    >
      {getButtonText()}
    </Button>
  );
}
