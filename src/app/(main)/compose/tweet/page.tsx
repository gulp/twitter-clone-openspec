"use client";

import { TweetComposer } from "@/components/tweet/tweet-composer";
import { useRouter } from "next/navigation";

export default function ComposeTweetPage() {
  const router = useRouter();

  const handleSuccess = () => {
    // Navigate back to home after successful post
    router.push("/home");
  };

  const handleCancel = () => {
    // Navigate back
    router.back();
  };

  return (
    <div className="min-h-screen bg-[#0F1419]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0F1419] border-b border-[#38444d] px-4 py-3 flex items-center justify-between">
        <button
          onClick={handleCancel}
          className="text-[#E7E9EA] font-manrope font-bold transition-colors hover:text-[#1DA1F2]"
        >
          Cancel
        </button>
        <h1 className="text-[#E7E9EA] font-manrope font-bold text-lg">New Post</h1>
        <div className="w-16" /> {/* Spacer for centering */}
      </div>

      {/* Composer */}
      <TweetComposer
        placeholder="What's happening?"
        onSuccess={handleSuccess}
        onCancel={handleCancel}
        autoFocus
      />
    </div>
  );
}
