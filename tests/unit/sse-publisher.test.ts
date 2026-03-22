import { describe, expect, it } from "vitest";
import { inMemoryPublisher } from "@/server/services/sse-publisher";

/**
 * Unit tests for SSE publisher in-memory fallback
 *
 * These tests verify the in-memory EventEmitter fallback works correctly
 * when Redis is unavailable (e.g., in test environments).
 */
describe("SSE Publisher — In-memory fallback", () => {
  it("should emit events to subscribers via in-memory EventEmitter", () => {
    const userId = "user123";
    const event = {
      type: "new-tweet" as const,
      data: {
        tweetId: "tweet456",
        authorUsername: "testuser",
      },
    };

    let receivedEvent: unknown = null;

    // Subscribe to events for this user
    const listener = (evt: unknown) => {
      receivedEvent = evt;
    };

    inMemoryPublisher.on(userId, listener);

    // Publish event
    inMemoryPublisher.publish(userId, event);

    // Verify event was received
    expect(receivedEvent).toEqual(event);

    // Cleanup
    inMemoryPublisher.off(userId, listener);
  });

  it("should support multiple subscribers for the same user", () => {
    const userId = "user789";
    const event = {
      type: "notification" as const,
      data: {
        notification: {
          id: "notif123",
          type: "FOLLOW",
          actorId: "actor456",
          createdAt: "2026-03-22T12:00:00Z",
        },
      },
    };

    const receivedEvents: unknown[] = [];

    const listener1 = (evt: unknown) => {
      receivedEvents.push({ listener: 1, event: evt });
    };

    const listener2 = (evt: unknown) => {
      receivedEvents.push({ listener: 2, event: evt });
    };

    inMemoryPublisher.on(userId, listener1);
    inMemoryPublisher.on(userId, listener2);

    // Publish event
    inMemoryPublisher.publish(userId, event);

    // Both listeners should receive the event
    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0]).toEqual({ listener: 1, event });
    expect(receivedEvents[1]).toEqual({ listener: 2, event });

    // Cleanup
    inMemoryPublisher.off(userId, listener1);
    inMemoryPublisher.off(userId, listener2);
  });

  it("should isolate events between different users", () => {
    const user1 = "user-a";
    const user2 = "user-b";

    const event1 = {
      type: "new-tweet" as const,
      data: { tweetId: "tweet-a", authorUsername: "usera" },
    };

    const event2 = {
      type: "new-tweet" as const,
      data: { tweetId: "tweet-b", authorUsername: "userb" },
    };

    let user1Event: unknown = null;
    let user2Event: unknown = null;

    const listener1 = (evt: unknown) => {
      user1Event = evt;
    };

    const listener2 = (evt: unknown) => {
      user2Event = evt;
    };

    inMemoryPublisher.on(user1, listener1);
    inMemoryPublisher.on(user2, listener2);

    // Publish event to user1
    inMemoryPublisher.publish(user1, event1);

    // Only user1's listener should receive event1
    expect(user1Event).toEqual(event1);
    expect(user2Event).toBeNull();

    // Reset
    user1Event = null;
    user2Event = null;

    // Publish event to user2
    inMemoryPublisher.publish(user2, event2);

    // Only user2's listener should receive event2
    expect(user1Event).toBeNull();
    expect(user2Event).toEqual(event2);

    // Cleanup
    inMemoryPublisher.off(user1, listener1);
    inMemoryPublisher.off(user2, listener2);
  });
});
