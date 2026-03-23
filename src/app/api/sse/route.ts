import { log } from "@/lib/logger";
import { authOptions } from "@/server/auth";
import { redis, sseAddConnection, sseGetConnections, sseRefreshConnectionTTL, sseRemoveConnection } from "@/server/redis";
import { sseSubscriberManager, shutdownSSESubscriber } from "@/server/services/sse-subscriber";
import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";

/**
 * SSE endpoint — real-time event streaming for authenticated users.
 *
 * GET /api/sse
 *
 * Protocol (§1.8):
 * - Content-Type: text/event-stream
 * - Includes retry: 5000 directive at connection start
 * - Event format: id:{seq}\nevent:{type}\ndata:{json}\n\n
 * - Heartbeat: ': heartbeat\n\n' every 30 seconds
 * - Replay buffer: sse:replay:{userId} (200 entries, 5-minute TTL)
 * - Connection tracking: sse:connections:{userId} (max 5 per user)
 * - Sequence numbers: sse:seq:{userId} (assigned by Lua publish script)
 *
 * Event types:
 * - new-tweet: { tweetId, authorUsername }
 * - notification: { notification }
 * - tweet_deleted: { tweetId }
 *
 * Security:
 * - Requires valid NextAuth session
 * - Rejects unauthenticated requests with 401
 */

// Track active connections for SIGTERM draining
const activeConnections = new Set<{
  userId: string;
  connectionId: string;
  controller: ReadableStreamDefaultController;
}>();

// SIGTERM handler for graceful shutdown
let shutdownInitiated = false;
process.once("SIGTERM", () => {
  shutdownInitiated = true;
  console.log("[SSE] SIGTERM received, draining connections");

  // Send server_restart event to all active connections
  for (const conn of activeConnections) {
    try {
      conn.controller.enqueue("event: server_restart\ndata: {}\n\n");
      conn.controller.close();
    } catch (error) {
      // Connection already closed
    }
  }

  activeConnections.clear();

  // Shutdown shared subscriber
  shutdownSSESubscriber().catch((error) => {
    console.error("[SSE] Failed to shutdown subscriber:", error);
  });
});

export async function GET(req: NextRequest) {
  // Check authentication
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  // Check if shutting down
  if (shutdownInitiated) {
    return new Response("event: server_restart\ndata: {}\n\n", {
      status: 503,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Check connection limit (max 5 per user)
  const existingConnections = await sseGetConnections(userId);
  if (existingConnections.length >= 5) {
    return new Response('event: error\ndata: {"message":"Too many connections"}\n\n', {
      status: 429,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Generate unique connection ID
  const connectionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Track connection in Redis
  await sseAddConnection(userId, connectionId);

  // Subscribe to user's channel via shared subscriber manager
  const channel = `sse:user:${userId}`;
  let unsubscribe: (() => void) | null = null;

  // SSE stream setup
  const encoder = new TextEncoder();
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let isClosed = false;
  let connTracker: { userId: string; connectionId: string; controller: ReadableStreamDefaultController } | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Track this connection for SIGTERM handling
      connTracker = { userId, connectionId, controller };
      activeConnections.add(connTracker);

      try {
        // Send retry directive at connection start
        controller.enqueue(encoder.encode("retry: 5000\n\n"));

        // Handle Last-Event-ID replay
        const lastEventId = req.headers.get("Last-Event-ID");
        if (lastEventId) {
          try {
            const lastSeq = Number.parseInt(lastEventId, 10);
            if (!Number.isNaN(lastSeq)) {
              // Fetch replay buffer from Redis
              const replayBuffer = await redis.lrange(`sse:replay:${userId}`, 0, 199);

              // Replay buffer is newest-first (LPUSH), reverse for chronological order
              for (const event of replayBuffer.reverse()) {
                try {
                  const parsed = JSON.parse(event);
                  if (parsed.seq > lastSeq) {
                    const sseEvent = `id: ${parsed.seq}\nevent: ${parsed.type}\ndata: ${JSON.stringify(parsed.data)}\n\n`;
                    controller.enqueue(encoder.encode(sseEvent));
                  }
                } catch {
                  // Skip malformed replay event
                }
              }
            }
          } catch (error) {
            console.warn("[SSE] Replay failed:", {
              userId,
              lastEventId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Set up heartbeat (30 seconds)
        heartbeatInterval = setInterval(() => {
          if (isClosed) return;

          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));

            // Refresh Redis TTL so stale connections auto-expire on crash
            sseRefreshConnectionTTL(userId).catch(() => {});

            if (process.env.NODE_ENV === "development") {
              log.info("SSE heartbeat", {
                userId,
                activeConnections: activeConnections.size,
              });
            }
          } catch (error) {
            // Write failed - connection broken
            cleanup();
          }
        }, 30000);

        // Subscribe to channel via shared subscriber manager
        unsubscribe = await sseSubscriberManager.subscribe(channel, (ch, message) => {
          if (ch !== channel || isClosed) return;

          try {
            const event = JSON.parse(message);

            // Extract sequence number from the message (assigned by Lua script)
            const seq = event.seq ?? Date.now(); // Fallback to timestamp if missing

            // Format SSE event
            const sseEvent = `id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

            // Send to client
            try {
              controller.enqueue(encoder.encode(sseEvent));
            } catch (error) {
              // Write failed - connection broken
              cleanup();
            }
          } catch (error) {
            console.warn("[SSE] Failed to process message:", {
              userId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      } catch (error) {
        console.error("[SSE] Stream start error:", {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        cleanup();
      }

      // Cleanup function
      function cleanup() {
        if (isClosed) return;
        isClosed = true;

        // Clear heartbeat
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        // Unsubscribe from shared subscriber
        if (unsubscribe) {
          unsubscribe();
        }

        // Remove from Redis connection tracking
        sseRemoveConnection(userId, connectionId).catch(() => {});

        // Remove from SIGTERM tracking
        if (connTracker) activeConnections.delete(connTracker);

        // Close stream
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },

    cancel() {
      // Client disconnected
      if (!isClosed) {
        isClosed = true;

        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }

        // Unsubscribe from shared subscriber
        if (unsubscribe) {
          unsubscribe();
        }

        sseRemoveConnection(userId, connectionId).catch(() => {});

        // Remove from SIGTERM tracking
        if (connTracker) {
          activeConnections.delete(connTracker);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering
    },
  });
}
