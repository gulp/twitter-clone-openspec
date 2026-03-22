/**
 * Integration test helpers
 *
 * Provides utilities for creating test data, managing test contexts,
 * and cleaning up after tests.
 */

import { randomUUID } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/server/db";
import { redis } from "@/server/redis";
import { appRouter } from "@/server/trpc/router";
import type { Session } from "next-auth";
import bcrypt from "bcryptjs";
import type { AppRouter } from "@/server/trpc/router";

/**
 * Per-test Redis key prefix to prevent cross-test pollution.
 * Each test should call this once at the start.
 */
export function getTestRedisPrefix(testId?: string): string {
  return `test:${testId || randomUUID()}:`;
}

/**
 * Create a test user with hashed password.
 *
 * @param overrides - Optional overrides for user fields
 * @returns User object with session data
 */
export async function createTestUser(overrides?: {
  email?: string;
  username?: string;
  displayName?: string;
  password?: string;
  bio?: string;
  avatarUrl?: string;
}) {
  const id = createId();
  const email = overrides?.email || `test-${id}@example.com`;
  const username = overrides?.username || `user_${id.slice(0, 6)}`;
  const displayName = overrides?.displayName || `Test User ${id.slice(0, 4)}`;
  const password = overrides?.password || "password123";
  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      id,
      email,
      username,
      displayName,
      bio: overrides?.bio || "",
      avatarUrl: overrides?.avatarUrl || "",
      hashedPassword,
    },
  });

  return {
    user,
    password, // Return plaintext password for login tests
  };
}

/**
 * Create a test tweet.
 *
 * @param authorId - User ID of the tweet author
 * @param overrides - Optional overrides for tweet fields
 * @returns Created tweet
 */
export async function createTestTweet(
  authorId: string,
  overrides?: {
    content?: string;
    parentId?: string;
    quoteTweetId?: string;
    mediaUrls?: string[];
  }
) {
  const content = overrides?.content || "This is a test tweet";

  const tweet = await prisma.tweet.create({
    data: {
      authorId,
      content,
      parentId: overrides?.parentId,
      quoteTweetId: overrides?.quoteTweetId,
      mediaUrls: overrides?.mediaUrls || [],
    },
  });

  // Increment author's tweet count
  await prisma.user.update({
    where: { id: authorId },
    data: { tweetCount: { increment: 1 } },
  });

  return tweet;
}

/**
 * Create a tRPC caller context for testing.
 *
 * @param userId - Optional user ID for authenticated context
 * @returns tRPC caller instance
 */
export function createTestContext(userId?: string) {
  const requestId = randomUUID();

  // Create session if userId provided
  const session: Session | null = userId
    ? {
        user: {
          id: userId,
          email: `${userId}@example.com`,
          name: "Test User",
        },
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }
    : null;

  // Create mock request object
  const req = new Request("http://localhost:3000/api/trpc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
  });

  // Create tRPC context
  const ctx = {
    session,
    requestId,
    req,
  };

  // Create tRPC caller
  return appRouter.createCaller(ctx);
}

/**
 * Clean up database tables in dependency-safe order.
 * Call this in beforeEach or afterEach hooks.
 */
export async function cleanupDatabase() {
  // Delete in reverse dependency order
  await prisma.notification.deleteMany();
  await prisma.retweet.deleteMany();
  await prisma.like.deleteMany();
  await prisma.tweet.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Flush test Redis keys.
 * Call this in beforeEach or afterEach hooks with the test prefix.
 */
export async function cleanupRedis(prefix: string) {
  try {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    // Redis errors are non-fatal in tests
    console.warn("[TEST] Redis cleanup failed:", error);
  }
}

/**
 * Capture structured logs during a test.
 * Useful for asserting log output.
 */
export class LogCapture {
  private logs: Array<{ level: string; msg: string; data: Record<string, unknown> }> = [];
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };

  constructor() {
    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
  }

  /**
   * Start capturing logs.
   */
  start() {
    this.logs = [];

    console.log = (...args: unknown[]) => {
      this.captureLog("info", args);
      this.originalConsole.log(...args);
    };

    console.warn = (...args: unknown[]) => {
      this.captureLog("warn", args);
      this.originalConsole.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      this.captureLog("error", args);
      this.originalConsole.error(...args);
    };
  }

  /**
   * Stop capturing logs and restore original console.
   */
  stop() {
    console.log = this.originalConsole.log;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
  }

  /**
   * Parse and capture a log entry.
   */
  private captureLog(level: string, args: unknown[]) {
    try {
      // Try to parse JSON log output
      const firstArg = args[0];
      if (typeof firstArg === "string") {
        const parsed = JSON.parse(firstArg);
        if (parsed.level && parsed.msg) {
          this.logs.push({
            level: parsed.level,
            msg: parsed.msg,
            data: parsed,
          });
        }
      }
    } catch {
      // Not a JSON log, ignore
    }
  }

  /**
   * Get all captured logs.
   */
  getLogs() {
    return this.logs;
  }

  /**
   * Get logs by level.
   */
  getLogsByLevel(level: "info" | "warn" | "error") {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Get logs by requestId.
   */
  getLogsByRequestId(requestId: string) {
    return this.logs.filter((log) => log.data.requestId === requestId);
  }

  /**
   * Get logs matching a message pattern.
   */
  getLogsByMessage(pattern: string | RegExp) {
    return this.logs.filter((log) =>
      typeof pattern === "string" ? log.msg.includes(pattern) : pattern.test(log.msg)
    );
  }

  /**
   * Clear captured logs.
   */
  clear() {
    this.logs = [];
  }
}
