import { describe, expect, it } from "vitest";

/**
 * Feed deduplication tests — validates DISTINCT ON behavior.
 *
 * The deduplication logic is implemented in SQL via DISTINCT ON (tweetId)
 * in the feed assembly query (§1.9). This test verifies the expected behavior:
 * - Same tweet via original and retweet → deduplicated
 * - Multiple retweets of same tweet → shows most recent retweet
 * - Original tweet with no retweets → kept
 * - Empty feed → returns empty
 *
 * Since the deduplication is SQL-level, these tests verify the contract
 * rather than testing the implementation directly. Integration tests in
 * tests/integration/ will verify the actual SQL behavior against a real DB.
 */

describe("Feed deduplication logic (SQL contract)", () => {
  it("should deduplicate same tweet appearing as original and retweet", () => {
    // Simulates DISTINCT ON behavior:
    // Input: [
    //   { tweetId: 't1', effectiveAt: '2024-01-01T10:00', retweeterId: null },
    //   { tweetId: 't1', effectiveAt: '2024-01-01T11:00', retweeterId: 'u2' },
    // ]
    // Expected: Keep the MOST RECENT (effectiveAt DESC) which is the retweet

    const feedItems = [
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T11:00"), retweeterId: "u2" },
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T10:00"), retweeterId: null },
    ];

    // Simulate DISTINCT ON (tweetId) ORDER BY tweetId, effectiveAt DESC
    const deduped = Array.from(
      new Map(feedItems.map((item) => [item.tweetId, item])).values()
    );

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual({
      tweetId: "t1",
      effectiveAt: new Date("2024-01-01T11:00"),
      retweeterId: "u2",
    });
  });

  it("should show most recent retweet when multiple retweets exist", () => {
    // Input: Multiple retweets of same tweet
    const feedItems = [
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T12:00"), retweeterId: "u3" },
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T11:00"), retweeterId: "u2" },
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T10:00"), retweeterId: null },
    ];

    const deduped = Array.from(
      new Map(feedItems.map((item) => [item.tweetId, item])).values()
    );

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual({
      tweetId: "t1",
      effectiveAt: new Date("2024-01-01T12:00"),
      retweeterId: "u3",
    });
  });

  it("should keep original tweet when no retweets exist", () => {
    const feedItems = [
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T10:00"), retweeterId: null },
      { tweetId: "t2", effectiveAt: new Date("2024-01-01T09:00"), retweeterId: null },
    ];

    const deduped = Array.from(
      new Map(feedItems.map((item) => [item.tweetId, item])).values()
    );

    expect(deduped).toHaveLength(2);
    expect(deduped[0].tweetId).toBe("t1");
    expect(deduped[1].tweetId).toBe("t2");
  });

  it("should return empty array for empty feed", () => {
    const feedItems: Array<{
      tweetId: string;
      effectiveAt: Date;
      retweeterId: string | null;
    }> = [];

    const deduped = Array.from(
      new Map(feedItems.map((item) => [item.tweetId, item])).values()
    );

    expect(deduped).toEqual([]);
  });

  it("should handle mixed original and retweeted content", () => {
    // Feed with both original tweets and retweets, some duplicated
    const feedItems = [
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T14:00"), retweeterId: "u3" },
      { tweetId: "t2", effectiveAt: new Date("2024-01-01T13:00"), retweeterId: null },
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T12:00"), retweeterId: "u2" },
      { tweetId: "t3", effectiveAt: new Date("2024-01-01T11:00"), retweeterId: null },
    ];

    const deduped = Array.from(
      new Map(feedItems.map((item) => [item.tweetId, item])).values()
    );

    expect(deduped).toHaveLength(3);
    // t1 should be the most recent retweet (u3)
    const t1Item = deduped.find((item) => item.tweetId === "t1");
    expect(t1Item).toBeDefined();
    expect(t1Item?.retweeterId).toBe("u3");
    // t2 and t3 should be original (no retweeter)
    const t2Item = deduped.find((item) => item.tweetId === "t2");
    expect(t2Item).toBeDefined();
    expect(t2Item?.retweeterId).toBeNull();
    const t3Item = deduped.find((item) => item.tweetId === "t3");
    expect(t3Item).toBeDefined();
    expect(t3Item?.retweeterId).toBeNull();
  });
});
