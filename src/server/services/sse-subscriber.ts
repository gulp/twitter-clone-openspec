import { env } from "@/env";
import { log } from "@/lib/logger";
import Redis from "ioredis";

/**
 * Shared SSE Subscriber Manager
 *
 * Maintains a single Redis subscriber connection and multiplexes
 * messages to all active SSE clients based on channel subscriptions.
 *
 * Fixes tw-96o: Prevents O(connections) Redis connections by using
 * a single subscriber with in-memory routing.
 *
 * Architecture:
 * - Single Redis subscriber instance (shared across all SSE connections)
 * - Map of channel → Set<callback> for message routing
 * - Auto-subscribe to Redis channel when first client connects
 * - Auto-unsubscribe from Redis when last client disconnects
 */

type MessageCallback = (channel: string, message: string) => void;

class SSESubscriberManager {
  private subscriber: Redis | null = null;
  private subscriptions = new Map<string, Set<MessageCallback>>();
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the shared Redis subscriber (lazy, once)
   */
  private async init(): Promise<void> {
    if (this.subscriber) return;

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      this.subscriber = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      // Set up global message handler - routes to all registered callbacks
      this.subscriber.on("message", (channel, message) => {
        const callbacks = this.subscriptions.get(channel);
        if (callbacks) {
          for (const callback of callbacks) {
            try {
              callback(channel, message);
            } catch (error) {
              log.warn("SSE subscriber callback error", {
                channel,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      });

      this.subscriber.on("error", (error) => {
        log.error("SSE shared subscriber error", {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      log.info("SSE shared subscriber initialized");
    })();

    await this.initPromise;
  }

  /**
   * Subscribe to a channel with a callback.
   * Returns an unsubscribe function for cleanup.
   *
   * @param channel - Redis channel to subscribe to (e.g., "sse:user:123")
   * @param callback - Function called when messages arrive on this channel
   * @returns Unsubscribe function to call on connection close
   */
  async subscribe(channel: string, callback: MessageCallback): Promise<() => void> {
    await this.init();

    // Add callback to the channel's callback set
    let callbacks = this.subscriptions.get(channel);
    if (!callbacks) {
      callbacks = new Set();
      this.subscriptions.set(channel, callbacks);
    }

    const isFirstSubscriber = callbacks.size === 0;
    callbacks.add(callback);

    // Subscribe to Redis channel only if this is the first listener
    if (isFirstSubscriber && this.subscriber) {
      await this.subscriber.subscribe(channel);
      log.info("SSE channel subscribed", {
        channel,
        totalChannels: this.subscriptions.size,
        totalCallbacks: this.getStats().totalCallbacks,
      });
    }

    // Return unsubscribe function
    return () => {
      this.unsubscribe(channel, callback);
    };
  }

  /**
   * Unsubscribe a callback from a channel.
   * Auto-unsubscribes from Redis if this was the last listener.
   */
  private unsubscribe(channel: string, callback: MessageCallback): void {
    const callbacks = this.subscriptions.get(channel);
    if (!callbacks) return;

    callbacks.delete(callback);

    // If no more callbacks for this channel, unsubscribe from Redis
    if (callbacks.size === 0) {
      this.subscriptions.delete(channel);

      if (this.subscriber) {
        this.subscriber.unsubscribe(channel).catch((error) => {
          log.warn("SSE channel unsubscribe failed", {
            channel,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        log.info("SSE channel unsubscribed", {
          channel,
          totalChannels: this.subscriptions.size,
        });
      }
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      activeChannels: this.subscriptions.size,
      totalCallbacks: Array.from(this.subscriptions.values()).reduce(
        (sum, callbacks) => sum + callbacks.size,
        0
      ),
    };
  }

  /**
   * Graceful shutdown (for SIGTERM)
   */
  async shutdown(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
      this.subscriptions.clear();
      log.info("SSE shared subscriber shutdown complete");
    }
  }
}

// Singleton instance
export const sseSubscriberManager = new SSESubscriberManager();

// Export for SIGTERM cleanup
export async function shutdownSSESubscriber(): Promise<void> {
  await sseSubscriberManager.shutdown();
}
