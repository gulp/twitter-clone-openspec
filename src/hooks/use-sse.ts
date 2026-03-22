"use client";

import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * SSE client hook with auto-reconnect and polling fallback.
 *
 * Connects to /api/sse and handles real-time events:
 * - new-tweet: increments newTweetCount
 * - notification: updates latestNotification
 * - tweet_deleted: removes tweet from React Query cache
 *
 * Auto-reconnect with exponential backoff (max 30s).
 * Falls back to polling notification.unreadCount after 3 consecutive failures.
 *
 * The EventSource API automatically sends Last-Event-ID header on reconnect,
 * which the server uses for event replay.
 */

interface SSEHookReturn {
  newTweetCount: number;
  latestNotification: Notification | null;
  resetTweetCount: () => void;
  isConnected: boolean;
  isFallback: boolean;
}

interface Notification {
  id: string;
  type: string;
  actorId: string;
  recipientId: string;
  tweetId: string | null;
  read: boolean;
  createdAt: string;
}

export function useSSE(): SSEHookReturn {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();

  const [newTweetCount, setNewTweetCount] = useState(0);
  const [latestNotification, setLatestNotification] = useState<Notification | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const resetTweetCount = useCallback(() => {
    setNewTweetCount(0);
  }, []);

  // Polling fallback for notifications (enabled after 3 SSE failures)
  trpc.notification.unreadCount.useQuery(undefined, {
    enabled: isFallback && status === "authenticated",
    refetchInterval: 30000, // Poll every 30s
  });

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    // Skip if not authenticated
    if (status !== "authenticated" || !session?.user) {
      return;
    }

    // Skip if already connected
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    cleanup();

    try {
      const es = new EventSource("/api/sse");
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0; // Reset on successful connection
        setIsFallback(false);
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();

        reconnectAttemptsRef.current += 1;

        // After 3 consecutive failures, fall back to polling
        if (reconnectAttemptsRef.current >= 3) {
          setIsFallback(true);
          return;
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      // Handle new-tweet events
      es.addEventListener("new-tweet", (event: MessageEvent) => {
        try {
          JSON.parse(event.data); // Validate JSON
          setNewTweetCount((prev) => prev + 1);
        } catch (error) {
          console.warn("[SSE] Failed to parse new-tweet event:", error);
        }
      });

      // Handle notification events
      es.addEventListener("notification", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          setLatestNotification(data.notification);

          // Invalidate notification queries to refetch
          queryClient.invalidateQueries({ queryKey: ["notification"] });
        } catch (error) {
          console.warn("[SSE] Failed to parse notification event:", error);
        }
      });

      // Handle tweet_deleted events
      es.addEventListener("tweet_deleted", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          const { tweetId } = data;

          // Remove tweet from all feed caches (handles infinite query pagination)
          queryClient.setQueriesData({ queryKey: ["feed"] }, (oldData: unknown) => {
            if (!oldData) return oldData;

            // Handle paginated data structure
            if (
              typeof oldData === "object" &&
              oldData !== null &&
              "pages" in oldData &&
              Array.isArray((oldData as { pages: unknown }).pages)
            ) {
              return {
                ...oldData,
                pages: (oldData as { pages: { items?: { id: string }[] }[] }).pages.map((page) => ({
                  ...page,
                  items: page.items?.filter((item) => item.id !== tweetId) ?? page.items,
                })),
              };
            }

            // Handle single page data
            if (
              typeof oldData === "object" &&
              oldData !== null &&
              "items" in oldData &&
              Array.isArray((oldData as { items: unknown }).items)
            ) {
              return {
                ...oldData,
                items: (oldData as { items: { id: string }[] }).items.filter(
                  (item) => item.id !== tweetId
                ),
              };
            }

            return oldData;
          });

          // Update tweet caches (mark as deleted or remove from replies)
          queryClient.setQueriesData({ queryKey: ["tweet"] }, (oldData: unknown) => {
            if (!oldData) return oldData;

            // Handle paginated replies
            if (
              typeof oldData === "object" &&
              oldData !== null &&
              "pages" in oldData &&
              Array.isArray((oldData as { pages: unknown }).pages)
            ) {
              return {
                ...oldData,
                pages: (oldData as { pages: { items?: { id: string }[] }[] }).pages.map((page) => ({
                  ...page,
                  items: page.items?.filter((item) => item.id !== tweetId) ?? page.items,
                })),
              };
            }

            // Handle single tweet - mark as deleted if it's the deleted one
            if (
              typeof oldData === "object" &&
              oldData !== null &&
              "id" in oldData &&
              (oldData as { id: string }).id === tweetId
            ) {
              return { ...oldData, deleted: true };
            }

            return oldData;
          });
        } catch (error) {
          console.warn("[SSE] Failed to parse tweet_deleted event:", error);
        }
      });

      // Handle server_restart event
      es.addEventListener("server_restart", () => {
        // Server is restarting, reconnect after a short delay
        setIsConnected(false);
        es.close();

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000);
      });
    } catch (error) {
      console.error("[SSE] Connection error:", error);
      setIsConnected(false);
    }
  }, [status, session, cleanup, queryClient]);

  // Connect on mount for authenticated users
  useEffect(() => {
    if (status === "authenticated") {
      connect();
    }

    return () => {
      cleanup();
    };
  }, [status, connect, cleanup]);

  return {
    newTweetCount,
    latestNotification,
    resetTweetCount,
    isConnected,
    isFallback,
  };
}
