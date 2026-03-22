"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

export default function NotificationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const { data, isLoading } = trpc.notification.list.useInfiniteQuery(
    {},
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: !!session,
    }
  );

  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate();
      utils.notification.unreadCount.invalidate();
    },
  });

  if (!session || isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-twitter-blue" />
      </div>
    );
  }

  const notifications = data?.pages.flatMap((p) => p.notifications) ?? [];

  const getNotificationText = (type: string) => {
    switch (type) {
      case "like":
        return "liked your tweet";
      case "retweet":
        return "retweeted your tweet";
      case "follow":
        return "followed you";
      case "reply":
        return "replied to your tweet";
      case "mention":
        return "mentioned you";
      default:
        return "interacted with you";
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "like":
        return <span className="text-pink-500">&#9829;</span>;
      case "retweet":
        return <span className="text-green-500">&#8634;</span>;
      case "follow":
        return <span className="text-twitter-blue">&#9734;</span>;
      case "reply":
        return <span className="text-twitter-blue">&#9993;</span>;
      case "mention":
        return <span className="text-twitter-blue">@</span>;
      default:
        return null;
    }
  };

  return (
    <div>
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-twitter-border">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="font-bold text-xl text-twitter-text-light">
            Notifications
          </h1>
          {notifications.some((n) => !n.read) && (
            <button
              onClick={() => markAllRead.mutate()}
              className="text-sm text-twitter-blue hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-12 text-twitter-text-gray">
          No notifications yet.
        </div>
      ) : (
        notifications.map((notification) => (
          <Link
            key={notification.id}
            href={
              notification.tweetId
                ? `/tweet/${notification.tweetId}`
                : `/${notification.actor.username}`
            }
            className={`flex items-start gap-3 px-4 py-3 border-b border-twitter-border hover:bg-white/[0.03] transition-colors ${
              !notification.read ? "bg-twitter-blue/5" : ""
            }`}
          >
            <div className="text-2xl mt-1 w-8 text-center">
              {getNotificationIcon(notification.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-twitter-dark-secondary flex items-center justify-center text-sm font-bold shrink-0">
                  {notification.actor.avatarUrl ? (
                    <img
                      src={notification.actor.avatarUrl}
                      className="w-8 h-8 rounded-full object-cover"
                      alt=""
                    />
                  ) : (
                    notification.actor.displayName[0]?.toUpperCase()
                  )}
                </div>
              </div>
              <p className="text-twitter-text-light text-sm mt-1">
                <span className="font-bold">
                  {notification.actor.displayName}
                </span>{" "}
                {getNotificationText(notification.type)}
              </p>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
