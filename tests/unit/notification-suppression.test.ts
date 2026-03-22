import { describe, expect, it, vi } from "vitest";

/**
 * Notification suppression tests — validates self-suppression rules.
 *
 * Per Invariant I6: NEVER create notifications where recipientId === actorId.
 * This is enforced at the notification service level.
 */

describe("Notification self-suppression (createNotification)", () => {
  it("should suppress self-like notification", async () => {
    const mockPrisma = {
      notification: {
        create: vi.fn(),
      },
    };

    vi.doMock("@/server/db", () => ({ prisma: mockPrisma }));
    vi.doMock("@/server/redis", () => ({ incrUnreadCount: vi.fn() }));
    vi.doMock("@/server/services/sse-publisher", () => ({ publishNotification: vi.fn() }));

    const { createNotification } = await import("@/server/services/notification");

    const result = await createNotification({
      recipientId: "user-1",
      actorId: "user-1",
      type: "LIKE",
      tweetId: "tweet-1",
    });

    expect(result).toBeNull();
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();

    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/redis");
    vi.doUnmock("@/server/services/sse-publisher");
  });

  it("should suppress self-reply notification", async () => {
    const mockPrisma = {
      notification: {
        create: vi.fn(),
      },
    };

    vi.doMock("@/server/db", () => ({ prisma: mockPrisma }));
    vi.doMock("@/server/redis", () => ({ incrUnreadCount: vi.fn() }));
    vi.doMock("@/server/services/sse-publisher", () => ({ publishNotification: vi.fn() }));

    const { createNotification } = await import("@/server/services/notification");

    const result = await createNotification({
      recipientId: "user-1",
      actorId: "user-1",
      type: "REPLY",
      tweetId: "tweet-1",
    });

    expect(result).toBeNull();
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();

    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/redis");
    vi.doUnmock("@/server/services/sse-publisher");
  });

  it("should suppress self-mention notification", async () => {
    const mockPrisma = {
      notification: {
        create: vi.fn(),
      },
    };

    vi.doMock("@/server/db", () => ({ prisma: mockPrisma }));
    vi.doMock("@/server/redis", () => ({ incrUnreadCount: vi.fn() }));
    vi.doMock("@/server/services/sse-publisher", () => ({ publishNotification: vi.fn() }));

    const { createNotification } = await import("@/server/services/notification");

    const result = await createNotification({
      recipientId: "user-1",
      actorId: "user-1",
      type: "MENTION",
      tweetId: "tweet-1",
    });

    expect(result).toBeNull();
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();

    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/redis");
    vi.doUnmock("@/server/services/sse-publisher");
  });

  it("should suppress self-follow notification", async () => {
    const mockPrisma = {
      notification: {
        create: vi.fn(),
      },
    };

    vi.doMock("@/server/db", () => ({ prisma: mockPrisma }));
    vi.doMock("@/server/redis", () => ({ incrUnreadCount: vi.fn() }));
    vi.doMock("@/server/services/sse-publisher", () => ({ publishNotification: vi.fn() }));

    const { createNotification } = await import("@/server/services/notification");

    const result = await createNotification({
      recipientId: "user-1",
      actorId: "user-1",
      type: "FOLLOW",
    });

    expect(result).toBeNull();
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();

    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/redis");
    vi.doUnmock("@/server/services/sse-publisher");
  });

  it("should suppress self-retweet notification", async () => {
    const mockPrisma = {
      notification: {
        create: vi.fn(),
      },
    };

    vi.doMock("@/server/db", () => ({ prisma: mockPrisma }));
    vi.doMock("@/server/redis", () => ({ incrUnreadCount: vi.fn() }));
    vi.doMock("@/server/services/sse-publisher", () => ({ publishNotification: vi.fn() }));

    const { createNotification } = await import("@/server/services/notification");

    const result = await createNotification({
      recipientId: "user-1",
      actorId: "user-1",
      type: "RETWEET",
      tweetId: "tweet-1",
    });

    expect(result).toBeNull();
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();

    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/redis");
    vi.doUnmock("@/server/services/sse-publisher");
  });

  it("should allow cross-user notifications", async () => {
    const mockPrisma = {
      notification: {
        create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      },
    };

    const mockIncrUnreadCount = vi.fn().mockResolvedValue(undefined);
    const mockPublishNotification = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/server/db", () => ({ prisma: mockPrisma }));
    vi.doMock("@/server/redis", () => ({ incrUnreadCount: mockIncrUnreadCount }));
    vi.doMock("@/server/services/sse-publisher", () => ({
      publishNotification: mockPublishNotification,
    }));

    const { createNotification } = await import("@/server/services/notification");

    const result = await createNotification({
      recipientId: "user-2",
      actorId: "user-1",
      type: "LIKE",
      tweetId: "tweet-1",
    });

    expect(result).toEqual({ id: "notif-1" });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientId: "user-2",
        actorId: "user-1",
        type: "LIKE",
        tweetId: "tweet-1",
        dedupeKey: undefined,
      },
      select: { id: true },
    });
    expect(mockIncrUnreadCount).toHaveBeenCalledWith("user-2");

    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/redis");
    vi.doUnmock("@/server/services/sse-publisher");
  });

  it("should handle deduplication for cross-user notifications", async () => {
    const mockPrisma = {
      notification: {
        create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      },
    };

    const mockIncrUnreadCount = vi.fn().mockResolvedValue(undefined);
    const mockPublishNotification = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/server/db", () => ({ prisma: mockPrisma }));
    vi.doMock("@/server/redis", () => ({ incrUnreadCount: mockIncrUnreadCount }));
    vi.doMock("@/server/services/sse-publisher", () => ({
      publishNotification: mockPublishNotification,
    }));

    const { createNotification } = await import("@/server/services/notification");

    const result = await createNotification({
      recipientId: "user-2",
      actorId: "user-1",
      type: "LIKE",
      tweetId: "tweet-1",
      dedupeKey: "like:user-1:tweet-1",
    });

    expect(result).toEqual({ id: "notif-1" });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientId: "user-2",
        actorId: "user-1",
        type: "LIKE",
        tweetId: "tweet-1",
        dedupeKey: "like:user-1:tweet-1",
      },
      select: { id: true },
    });

    vi.doUnmock("@/server/db");
    vi.doUnmock("@/server/redis");
    vi.doUnmock("@/server/services/sse-publisher");
  });
});

/**
 * NOTE: Self-retweet and self-follow are ALSO blocked at the engagement/social
 * router level, so these tests verify defense-in-depth. The notification service
 * would suppress them even if they somehow bypassed the router checks.
 */
