"use client";

import { useSSE } from "@/hooks/use-sse";

export interface NewTweetsIndicatorProps {
  onShowNewTweets: () => void;
}

/**
 * New tweets indicator banner
 *
 * Displays "N new tweets" when SSE fires new-tweet events.
 * Clicking scrolls to top and shows new tweets.
 *
 * Gracefully handles SSE unavailability:
 * - If SSE is disconnected or unavailable, shows nothing (no crash)
 * - SSE integration is fully wired when E3 (use-sse hook) completes
 * - During parallel development, this degrades gracefully
 */
export function NewTweetsIndicator({ onShowNewTweets }: NewTweetsIndicatorProps) {
  const { newTweetCount, resetTweetCount, isConnected } = useSSE();

  // Don't show if no new tweets or SSE not connected
  if (!isConnected || newTweetCount === 0) {
    return null;
  }

  const handleClick = () => {
    resetTweetCount();
    onShowNewTweets();
  };

  return (
    <button
      onClick={handleClick}
      className="sticky top-0 z-10 w-full py-3 bg-[#1DA1F2] text-[#0F1419] font-manrope font-bold text-sm transition-all hover:bg-[#1a8cd8] active:scale-98 flex items-center justify-center gap-2"
      aria-live="polite"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
      </svg>
      <span>{newTweetCount === 1 ? "1 new tweet" : `${newTweetCount} new tweets`}</span>
    </button>
  );
}
