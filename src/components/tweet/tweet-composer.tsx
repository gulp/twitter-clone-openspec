"use client";

import { Button } from "@/components/ui/button";
import { MAX_TWEET_LENGTH } from "@/lib/constants";
import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Avatar } from "../ui/avatar";
import { ImageUpload } from "../media/image-upload";

export interface TweetComposerProps {
  parentId?: string;
  quoteTweetId?: string;
  placeholder?: string;
  onSuccess?: (tweetId: string) => void;
  onCancel?: () => void;
  replyToUser?: {
    username: string;
    displayName: string;
  };
  autoFocus?: boolean;
}

export function TweetComposer({
  parentId,
  quoteTweetId,
  placeholder = "What's happening?",
  onSuccess,
  onCancel,
  replyToUser,
  autoFocus = false,
}: TweetComposerProps) {
  const { data: session } = useSession();
  const [content, setContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const utils = trpc.useUtils();

  const createTweetMutation = trpc.tweet.create.useMutation({
    onSuccess: (data) => {
      setContent("");
      setMediaUrls([]);

      // Invalidate relevant queries
      utils.feed.home.invalidate();
      if (parentId) {
        utils.tweet.getReplies.invalidate({ tweetId: parentId });
      }

      onSuccess?.(data.id);
    },
  });

  const quoteTweetMutation = trpc.engagement.quoteTweet.useMutation({
    onSuccess: (data) => {
      setContent("");
      setMediaUrls([]);

      utils.feed.home.invalidate();
      onSuccess?.(data.id);
    },
  });

  const charCount = content.length;
  const isOverLimit = charCount > MAX_TWEET_LENGTH;
  const canSubmit = (content.trim().length > 0 || mediaUrls.length > 0) && !isOverLimit;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const input = {
      content: content.trim() || undefined,
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
      ...(parentId && { parentId }),
    };

    if (quoteTweetId) {
      quoteTweetMutation.mutate({
        content: content.trim() || undefined,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        quoteTweetId,
      });
    } else {
      createTweetMutation.mutate(input);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter to submit
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isLoading = createTweetMutation.isPending || quoteTweetMutation.isPending;

  if (!session) {
    return null;
  }

  return (
    <div className="border-b border-[#38444d] px-4 py-3">
      {replyToUser && (
        <div className="mb-2 text-sm text-[#71767B]">
          Replying to{" "}
          <span className="text-[#1DA1F2] hover:underline cursor-pointer">
            @{replyToUser.username}
          </span>
        </div>
      )}

      <div className="flex gap-3">
        <Avatar
          src={session.user.image}
          alt={session.user.name || "Your avatar"}
          size="md"
        />

        <div className="flex-1 min-w-0">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className="w-full bg-transparent text-[#E7E9EA] text-xl placeholder:text-[#71767B] resize-none border-none outline-none min-h-[120px] font-normal"
            rows={3}
          />

          {/* Image upload preview */}
          {mediaUrls.length > 0 && (
            <div className="mt-3">
              <ImageUpload
                urls={mediaUrls}
                onChange={setMediaUrls}
                maxImages={4}
              />
            </div>
          )}

          {/* Actions bar */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#38444d]">
            <div className="flex items-center gap-1">
              {/* Media button */}
              <ImageUpload
                urls={mediaUrls}
                onChange={setMediaUrls}
                maxImages={4}
                trigger={
                  <button
                    type="button"
                    className="p-2 rounded-full transition-colors hover:bg-[#1DA1F2]/10 text-[#1DA1F2]"
                    aria-label="Add media"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM8 11.5c0-1.381-1.119-2.5-2.5-2.5S3 10.119 3 11.5 4.119 14 5.5 14 8 12.881 8 11.5z" />
                    </svg>
                  </button>
                }
              />
            </div>

            <div className="flex items-center gap-3">
              {/* Character counter */}
              {charCount > 0 && (
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-sm ${
                      isOverLimit
                        ? "text-[#F91880]"
                        : charCount > MAX_TWEET_LENGTH - 20
                        ? "text-[#FFD400]"
                        : "text-[#71767B]"
                    }`}
                  >
                    {charCount}/{MAX_TWEET_LENGTH}
                  </span>
                  {/* Circular progress */}
                  <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                    <circle
                      cx="10"
                      cy="10"
                      r="8"
                      fill="none"
                      stroke="#38444d"
                      strokeWidth="2"
                    />
                    <circle
                      cx="10"
                      cy="10"
                      r="8"
                      fill="none"
                      stroke={
                        isOverLimit
                          ? "#F91880"
                          : charCount > MAX_TWEET_LENGTH - 20
                          ? "#FFD400"
                          : "#1DA1F2"
                      }
                      strokeWidth="2"
                      strokeDasharray={`${(charCount / MAX_TWEET_LENGTH) * 50.265} 50.265`}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              )}

              {/* Cancel button (if provided) */}
              {onCancel && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              )}

              {/* Submit button */}
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || isLoading}
                loading={isLoading}
                size="sm"
                className="font-manrope font-bold"
              >
                {parentId ? "Reply" : quoteTweetId ? "Quote" : "Post"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
