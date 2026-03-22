"use client";

import { TweetCard, type TweetCardProps } from "./tweet-card";

export interface TweetThreadProps {
  tweets: TweetCardProps["tweet"][];
  currentUserId?: string;
}

export function TweetThread({ tweets, currentUserId: _currentUserId }: TweetThreadProps) {
  if (tweets.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      {tweets.map((tweet, index) => {
        const isLast = index === tweets.length - 1;
        const showLine = !isLast;

        return (
          <div key={tweet.id} className="relative">
            <TweetCard tweet={tweet} showParentLine={showLine} />
          </div>
        );
      })}
    </div>
  );
}
