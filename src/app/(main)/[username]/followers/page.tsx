"use client";

import { UserList } from "@/components/profile/user-list";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useParams, useRouter } from "next/navigation";

export default function FollowersPage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;

  const { data: user, isLoading, isError } = trpc.user.getByUsername.useQuery({ username });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#15202B]">
        {/* Header skeleton */}
        <div className="sticky top-0 z-10 bg-[#15202B]/80 backdrop-blur-md border-b border-[#2f3336]">
          <div className="px-4 py-3">
            <Skeleton className="h-6 w-6 rounded-full mb-2" />
            <Skeleton className="h-6 w-40 mb-1" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex border-b border-[#2f3336]">
            <div className="flex-1 py-4" />
            <div className="flex-1 py-4" />
          </div>
        </div>
        {/* User list skeleton */}
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border-b border-[#2f3336] px-4 py-3">
              <div className="flex gap-3">
                <Skeleton className="w-12 h-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <div className="flex gap-4">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="min-h-screen bg-[#15202B] flex flex-col items-center justify-center px-4">
        <h1 className="text-[31px] font-manrope font-bold text-[#E7E9EA] mb-2">
          Something went wrong
        </h1>
        <p className="text-[#71767B] text-[15px] mb-6">Unable to load this profile.</p>
        <button
          onClick={() => router.push("/home")}
          className="text-[#1DA1F2] hover:underline font-bold"
        >
          Go to Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#15202B]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#15202B]/80 backdrop-blur-md border-b border-[#2f3336]">
        <div className="px-4 py-3">
          <button
            onClick={() => router.push(`/${username}`)}
            className="text-[#E7E9EA] hover:bg-[#1d2935] rounded-full p-2 -ml-2 transition-colors duration-200 mb-2"
            aria-label="Back"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z" />
            </svg>
          </button>
          <h1 className="text-xl font-manrope font-bold text-[#E7E9EA]">{user.displayName}</h1>
          <p className="text-[13px] text-[#71767B]">@{user.username}</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#2f3336]">
          <button
            onClick={() => router.push(`/${username}/followers`)}
            className="flex-1 py-4 text-center font-manrope font-bold text-[15px] text-[#E7E9EA] relative"
          >
            Followers
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#1DA1F2] rounded-full" />
          </button>
          <button
            onClick={() => router.push(`/${username}/following`)}
            className="flex-1 py-4 text-center font-manrope font-bold text-[15px] text-[#71767B] hover:bg-[#1d2935]/50 transition-colors duration-200"
          >
            Following
          </button>
        </div>
      </div>

      {/* User List */}
      <UserList userId={user.id} type="followers" />
    </div>
  );
}
