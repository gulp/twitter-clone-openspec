import { describe, expect, it, vi } from "vitest";
import { parseMentions, resolveMentions } from "@/server/services/mention";

/**
 * Mention parser tests — validates @username extraction and resolution.
 */

describe("parseMentions", () => {
  it("should extract @username at start of text", () => {
    const mentions = parseMentions("@alice hello world");
    expect(mentions).toEqual(["alice"]);
  });

  it("should extract @username in middle of text", () => {
    const mentions = parseMentions("hello @bob how are you?");
    expect(mentions).toEqual(["bob"]);
  });

  it("should extract @username at end of text", () => {
    const mentions = parseMentions("checking in with @carol");
    expect(mentions).toEqual(["carol"]);
  });

  it("should extract multiple @mentions", () => {
    const mentions = parseMentions("@alice and @bob please review @carol");
    expect(mentions).toEqual(["alice", "bob", "carol"]);
  });

  it("should handle @username followed by punctuation", () => {
    const mentions = parseMentions("@alice, @bob! @carol? @dave.");
    expect(mentions).toEqual(["alice", "bob", "carol", "dave"]);
  });

  it("should extract usernames with underscores and numbers", () => {
    const mentions = parseMentions("@user_123 and @test_456");
    expect(mentions).toEqual(["user_123", "test_456"]);
  });

  it("should ignore @ alone without username", () => {
    const mentions = parseMentions("@ @@ send to @ me");
    expect(mentions).toEqual([]);
  });

  it("should deduplicate @mentions", () => {
    const mentions = parseMentions("@alice and @alice again @alice");
    expect(mentions).toEqual(["alice"]);
  });

  it("should return empty array for empty string", () => {
    const mentions = parseMentions("");
    expect(mentions).toEqual([]);
  });

  it("should ignore usernames shorter than 3 chars", () => {
    const mentions = parseMentions("@ab @alice @xy");
    expect(mentions).toEqual(["alice"]);
  });

  it("should ignore usernames longer than 15 chars", () => {
    const mentions = parseMentions("@alice @verylongusername123456");
    expect(mentions).toEqual(["alice"]);
  });

  it("should ignore usernames with invalid characters", () => {
    const mentions = parseMentions("@alice @bob-smith @carol.doe @dave_123");
    // Only alice and dave_123 are valid (alphanumeric + underscore)
    expect(mentions).toEqual(["alice", "dave_123"]);
  });
});

describe("resolveMentions", () => {
  it("should return empty array for empty input", async () => {
    const userIds = await resolveMentions([]);
    expect(userIds).toEqual([]);
  });

  it("should return user IDs for existing users", async () => {
    // Mock prisma.user.findMany
    const mockPrisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: "user-1" },
          { id: "user-2" },
        ]),
      },
    };

    vi.doMock("@/server/db", () => ({
      prisma: mockPrisma,
    }));

    const { resolveMentions } = await import("@/server/services/mention");
    const userIds = await resolveMentions(["alice", "bob"]);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: {
        username: {
          in: ["alice", "bob"],
        },
      },
      select: {
        id: true,
      },
    });

    expect(userIds).toEqual(["user-1", "user-2"]);

    vi.doUnmock("@/server/db");
  });

  it("should filter out non-existent users", async () => {
    // Mock prisma.user.findMany to return only one user
    const mockPrisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: "user-1" }]),
      },
    };

    vi.doMock("@/server/db", () => ({
      prisma: mockPrisma,
    }));

    const { resolveMentions } = await import("@/server/services/mention");
    const userIds = await resolveMentions(["alice", "nonexistent"]);

    expect(userIds).toEqual(["user-1"]);

    vi.doUnmock("@/server/db");
  });
});
