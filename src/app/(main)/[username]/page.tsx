"use client";

import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { TweetCard } from "@/components/TweetCard";
import { FollowButton } from "@/components/FollowButton";

export default function ProfilePage() {
  const params = useParams();
  const username = params.username as string;
  const utils = trpc.useUtils();

  const { data: user, isLoading: userLoading, isError } =
    trpc.user.getByUsername.useQuery({ username });

  const { data, fetchNextPage, hasNextPage } =
    trpc.feed.userTimeline.useInfiniteQuery(
      { username },
      { getNextPageParam: (lastPage) => lastPage.nextCursor, enabled: !!user }
    );

  if (userLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-twitter-blue" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-twitter-text-light">
          This account doesn&apos;t exist
        </h2>
        <p className="text-twitter-text-gray mt-2">Try searching for another.</p>
      </div>
    );
  }

  const tweets = data?.pages.flatMap((page) => page.tweets) ?? [];
  const joinDate = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-twitter-border">
        <div className="flex items-center gap-6 px-4 py-2">
          <div>
            <h1 className="font-bold text-xl text-twitter-text-light">
              {user.displayName}
            </h1>
            <p className="text-sm text-twitter-text-gray">
              {user._count.tweets} tweets
            </p>
          </div>
        </div>
      </div>

      {/* Banner */}
      <div className="h-48 bg-twitter-dark-secondary">
        {user.bannerUrl && (
          <img src={user.bannerUrl} className="w-full h-48 object-cover" alt="" />
        )}
      </div>

      {/* Profile info */}
      <div className="px-4 pb-3 border-b border-twitter-border">
        <div className="flex justify-between items-start -mt-16 mb-3">
          <div className="w-32 h-32 rounded-full bg-twitter-dark-secondary border-4 border-black flex items-center justify-center text-4xl font-bold">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                className="w-full h-full rounded-full object-cover"
                alt=""
              />
            ) : (
              user.displayName[0]?.toUpperCase()
            )}
          </div>
          <div className="mt-18 pt-4">
            <FollowButton userId={user.id} isFollowing={user.isFollowing} />
          </div>
        </div>

        <h2 className="text-xl font-bold text-twitter-text-light">
          {user.displayName}
        </h2>
        <p className="text-twitter-text-gray">@{user.username}</p>

        {user.bio && (
          <p className="mt-2 text-twitter-text-light">{user.bio}</p>
        )}

        <p className="mt-2 text-twitter-text-gray text-sm">
          Joined {joinDate}
        </p>

        <div className="flex gap-4 mt-2 text-sm">
          <span>
            <span className="font-bold text-twitter-text-light">
              {user._count.following}
            </span>{" "}
            <span className="text-twitter-text-gray">Following</span>
          </span>
          <span>
            <span className="font-bold text-twitter-text-light">
              {user._count.followers}
            </span>{" "}
            <span className="text-twitter-text-gray">Followers</span>
          </span>
        </div>
      </div>

      {/* Tweets */}
      {tweets.length === 0 ? (
        <div className="text-center py-12 text-twitter-text-gray">
          No tweets yet.
        </div>
      ) : (
        <>
          {tweets.map((tweet) => (
            <TweetCard
              key={tweet.id}
              tweet={tweet}
              onDelete={() => utils.feed.userTimeline.invalidate({ username })}
            />
          ))}
          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              className="w-full py-4 text-twitter-blue hover:bg-white/[0.03]"
            >
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
