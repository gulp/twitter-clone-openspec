"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";

export function Composer({
  parentId,
  placeholder = "What is happening?!",
  onSuccess,
}: {
  parentId?: string;
  placeholder?: string;
  onSuccess?: () => void;
}) {
  const { data: session } = useSession();
  const [content, setContent] = useState("");

  const createTweet = trpc.tweet.create.useMutation({
    onSuccess: () => {
      setContent("");
      onSuccess?.();
    },
  });

  if (!session) return null;

  const charCount = content.length;
  const isOverLimit = charCount > 280;
  const canSubmit = content.trim().length > 0 && !isOverLimit;

  return (
    <div className="border-b border-twitter-border px-4 py-3">
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-twitter-dark-secondary flex items-center justify-center text-lg font-bold shrink-0">
          {session.user.name?.[0]?.toUpperCase() || "?"}
        </div>
        <div className="flex-1">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-transparent text-xl text-twitter-text-light placeholder-twitter-text-gray resize-none outline-none min-h-[80px]"
            rows={2}
          />
          <div className="flex items-center justify-between border-t border-twitter-border pt-3">
            <div className="flex items-center gap-2">
              {charCount > 0 && (
                <span
                  className={`text-sm ${
                    isOverLimit
                      ? "text-red-500"
                      : charCount > 260
                      ? "text-yellow-500"
                      : "text-twitter-text-gray"
                  }`}
                >
                  {280 - charCount}
                </span>
              )}
            </div>
            <button
              onClick={() =>
                createTweet.mutate({ content, parentId })
              }
              disabled={!canSubmit || createTweet.isPending}
              className="bg-twitter-blue hover:bg-twitter-blue-hover text-white font-bold rounded-full px-5 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {parentId ? "Reply" : "Post"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
