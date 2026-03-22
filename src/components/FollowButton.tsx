"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";

export function FollowButton({
  userId,
  isFollowing: initialIsFollowing,
}: {
  userId: string;
  isFollowing: boolean;
}) {
  const { data: session } = useSession();
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [hover, setHover] = useState(false);
  const utils = trpc.useUtils();

  const followMutation = trpc.social.follow.useMutation({
    onSuccess: () => {
      setIsFollowing(true);
      utils.user.getByUsername.invalidate();
    },
  });

  const unfollowMutation = trpc.social.unfollow.useMutation({
    onSuccess: () => {
      setIsFollowing(false);
      utils.user.getByUsername.invalidate();
    },
  });

  if (!session || session.user.id === userId) return null;

  if (isFollowing) {
    return (
      <button
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => unfollowMutation.mutate({ userId })}
        className={`rounded-full px-4 py-1.5 text-sm font-bold border transition-colors ${
          hover
            ? "border-red-500/50 text-red-500 bg-red-500/10"
            : "border-twitter-border text-twitter-text-light"
        }`}
      >
        {hover ? "Unfollow" : "Following"}
      </button>
    );
  }

  return (
    <button
      onClick={() => followMutation.mutate({ userId })}
      className="bg-twitter-text-light text-black rounded-full px-4 py-1.5 text-sm font-bold hover:bg-gray-200 transition-colors"
    >
      Follow
    </button>
  );
}
