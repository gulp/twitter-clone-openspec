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
    // SQL: DISTINCT ON (tweetId) ... ORDER BY tweetId, effectiveAt DESC
    // This keeps the FIRST row for each tweetId after sorting
    // Input: [
    //   { tweetId: 't1', effectiveAt: '2024-01-01T11:00', retweeterId: 'u2' },  ← first after sort
    //   { tweetId: 't1', effectiveAt: '2024-01-01T10:00', retweeterId: null },
    // ]
    // Expected: Keep the retweet (most recent effectiveAt)

    const feedItems = [
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T11:00"), retweeterId: "u2" },
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T10:00"), retweeterId: null },
    ];

    // Simulate DISTINCT ON: already sorted DESC, so first item wins
    const seen = new Set<string>();
    const deduped = feedItems.filter((item) => {
      if (seen.has(item.tweetId)) return false;
      seen.add(item.tweetId);
      return true;
    });

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toEqual({
      tweetId: "t1",
      effectiveAt: new Date("2024-01-01T11:00"),
      retweeterId: "u2",
    });
  });

  it("should show most recent retweet when multiple retweets exist", () => {
    // Input: Multiple retweets of same tweet (already sorted DESC)
    const feedItems = [
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T12:00"), retweeterId: "u3" },
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T11:00"), retweeterId: "u2" },
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T10:00"), retweeterId: null },
    ];

    // Simulate DISTINCT ON: first item wins
    const seen = new Set<string>();
    const deduped = feedItems.filter((item) => {
      if (seen.has(item.tweetId)) return false;
      seen.add(item.tweetId);
      return true;
    });

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

    // Simulate DISTINCT ON: no duplicates, so all items kept
    const seen = new Set<string>();
    const deduped = feedItems.filter((item) => {
      if (seen.has(item.tweetId)) return false;
      seen.add(item.tweetId);
      return true;
    });

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

    // Simulate DISTINCT ON: empty input = empty output
    const seen = new Set<string>();
    const deduped = feedItems.filter((item) => {
      if (seen.has(item.tweetId)) return false;
      seen.add(item.tweetId);
      return true;
    });

    expect(deduped).toEqual([]);
  });

  it("should handle mixed original and retweeted content", () => {
    // Feed with both original tweets and retweets, some duplicated (sorted DESC)
    const feedItems = [
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T14:00"), retweeterId: "u3" },
      { tweetId: "t2", effectiveAt: new Date("2024-01-01T13:00"), retweeterId: null },
      { tweetId: "t1", effectiveAt: new Date("2024-01-01T12:00"), retweeterId: "u2" },
      { tweetId: "t3", effectiveAt: new Date("2024-01-01T11:00"), retweeterId: null },
    ];

    // Simulate DISTINCT ON: first occurrence wins
    const seen = new Set<string>();
    const deduped = feedItems.filter((item) => {
      if (seen.has(item.tweetId)) return false;
      seen.add(item.tweetId);
      return true;
    });

    expect(deduped).toHaveLength(3);
    // t1 should be the most recent retweet (u3, first in list)
    const t1Item = deduped.find((item) => item.tweetId === "t1");
    expect(t1Item).toBeDefined();
    if (t1Item) {
      expect(t1Item.retweeterId).toBe("u3");
    }
    // t2 and t3 should be original (no retweeter)
    const t2Item = deduped.find((item) => item.tweetId === "t2");
    expect(t2Item).toBeDefined();
    if (t2Item) {
      expect(t2Item.retweeterId).toBeNull();
    }
    const t3Item = deduped.find((item) => item.tweetId === "t3");
    expect(t3Item).toBeDefined();
    if (t3Item) {
      expect(t3Item.retweeterId).toBeNull();
    }
  });
});
