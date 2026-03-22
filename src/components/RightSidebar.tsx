"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { FollowButton } from "./FollowButton";

export function RightSidebar() {
  const { data: session } = useSession();
  const { data: suggestions } = trpc.user.getSuggestions.useQuery(undefined, {
    enabled: !!session,
  });

  return (
    <div className="py-3 space-y-4">
      {session && suggestions && suggestions.length > 0 && (
        <div className="bg-twitter-dark-secondary rounded-2xl">
          <h2 className="font-bold text-xl px-4 py-3 text-twitter-text-light">
            Who to follow
          </h2>
          {suggestions.map((user) => (
            <div
              key={user.id}
              className="px-4 py-3 hover:bg-white/[0.03] transition-colors flex items-center gap-3"
            >
              <Link href={`/${user.username}`} className="shrink-0">
                <div className="w-10 h-10 rounded-full bg-twitter-border flex items-center justify-center font-bold">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      className="w-10 h-10 rounded-full object-cover"
                      alt=""
                    />
                  ) : (
                    user.displayName[0]?.toUpperCase()
                  )}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <Link href={`/${user.username}`}>
                  <p className="font-bold text-sm text-twitter-text-light truncate hover:underline">
                    {user.displayName}
                  </p>
                  <p className="text-sm text-twitter-text-gray truncate">
                    @{user.username}
                  </p>
                </Link>
              </div>
              <FollowButton userId={user.id} isFollowing={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
