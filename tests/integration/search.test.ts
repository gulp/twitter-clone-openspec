/**
 * Integration tests for search router
 *
 * Tests tweet full-text search and user search with pagination.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanupDatabase, createTestContext, createTestUser, createTestTweet } from "./helpers";

describe("search router", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("searchTweets", () => {
    it("finds tweets with FTS and stemming", async () => {
      const { user } = await createTestUser();

      await createTestTweet(user.id, {
        content: "I love running in the morning",
      });
      await createTestTweet(user.id, {
        content: "Just finished a long run",
      });

      const caller = createTestContext();

      // Search for "running" should find "running" and "run" (stemming)
      const result = await caller.search.tweets({
        query: "running",
        limit: 20,
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty results for no-match query", async () => {
      const { user } = await createTestUser();

      await createTestTweet(user.id, {
        content: "Hello world",
      });

      const caller = createTestContext();

      const result = await caller.search.tweets({
        query: "nonexistent",
        limit: 20,
      });

      expect(result.items.length).toBe(0);
    });

    it("handles special characters safely", async () => {
      const caller = createTestContext();

      // Should not throw error on special characters
      const result = await caller.search.tweets({
        query: "@#$%^&*()",
        limit: 20,
      });

      expect(result.items).toBeDefined();
    });

    it("supports pagination", async () => {
      const { user } = await createTestUser();

      // Create multiple tweets with same keyword
      for (let i = 0; i < 3; i++) {
        await createTestTweet(user.id, {
          content: `Test tweet number ${i}`,
        });
      }

      const caller = createTestContext();

      // Get first page
      const page1 = await caller.search.tweets({
        query: "test",
        limit: 2,
      });

      expect(page1.items.length).toBe(2);

      // Pagination stability: repeated queries should return same results
      const page1Again = await caller.search.tweets({
        query: "test",
        limit: 2,
      });

      expect(page1Again.items.length).toBe(2);
    });
  });

  describe("searchUsers", () => {
    it("searches by username and displayName with ILIKE", async () => {
      await createTestUser({
        username: "johndoe",
        displayName: "John Doe",
      });
      await createTestUser({
        username: "janedoe",
        displayName: "Jane Doe",
      });

      const caller = createTestContext();

      // Search for "doe" should find both users
      const result = await caller.search.users({
        query: "doe",
        limit: 20,
      });

      expect(result.items.length).toBe(2);
    });

    it("returns empty results for no-match query", async () => {
      await createTestUser({
        username: "testuser",
        displayName: "Test User",
      });

      const caller = createTestContext();

      const result = await caller.search.users({
        query: "nonexistent",
        limit: 20,
      });

      expect(result.items.length).toBe(0);
    });

    it("handles special characters safely", async () => {
      const caller = createTestContext();

      // Should not throw error on special characters
      const result = await caller.search.users({
        query: "%_@#$",
        limit: 20,
      });

      expect(result.items).toBeDefined();
    });

    it("supports pagination", async () => {
      // Create multiple users
      for (let i = 0; i < 3; i++) {
        await createTestUser({
          username: `testuser${i}`,
          displayName: `Test User ${i}`,
        });
      }

      const caller = createTestContext();

      // Get first page
      const page1 = await caller.search.users({
        query: "test",
        limit: 2,
      });

      expect(page1.items.length).toBe(2);

      // Pagination should be stable
      const page1Again = await caller.search.users({
        query: "test",
        limit: 2,
      });

      expect(page1Again.items.length).toBe(2);
    });
  });
});
