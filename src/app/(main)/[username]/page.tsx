"use client";

import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { trpc } from "@/lib/trpc";
import { useParams, useRouter } from "next/navigation";

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;

  const { data: user, isLoading, isError } = trpc.user.getByUsername.useQuery({ username });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#15202B] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-[#1DA1F2] border-t-transparent" />
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="min-h-screen bg-[#15202B] flex flex-col items-center justify-center px-4">
        <h1 className="text-[31px] font-manrope font-bold text-[#E7E9EA] mb-2">
          This account doesn't exist
        </h1>
        <p className="text-[#71767B] text-[15px] mb-6">Try searching for another.</p>
        <button
          onClick={() => router.back()}
          className="text-[#1DA1F2] hover:underline font-bold"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#15202B]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#15202B]/80 backdrop-blur-md border-b border-[#2f3336]">
        <div className="px-4 py-3">
          <h1 className="text-xl font-manrope font-bold text-[#E7E9EA]">{user.displayName}</h1>
          <p className="text-[13px] text-[#71767B]">
            {user.tweetCount.toLocaleString()} {user.tweetCount === 1 ? "Tweet" : "Tweets"}
          </p>
        </div>
      </div>

      {/* Profile Header */}
      <ProfileHeader user={user} />

      {/* Profile Tabs */}
      <ProfileTabs userId={user.id} />
    </div>
  );
}
