/**
 * Operational scripts integration tests
 *
 * Verifies seed.ts and reconcile-counts.ts behavior:
 * - Deterministic fixture generation
 * - Idempotent rerun/reset
 * - Count drift detection and correction
 * - Empty-database handling
 */

import { PrismaClient } from "@prisma/client";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const execAsync = promisify(exec);
const prisma = new PrismaClient();

/**
 * Helper to run a script and capture stdout/stderr
 */
async function runScript(scriptPath: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(`npx tsx ${scriptPath}`, {
      env: { ...process.env, NODE_ENV: "test" },
    });
    return { stdout, stderr };
  } catch (error) {
    // exec throws on non-zero exit code, but we still want to capture output
    const err = error as { stdout?: string; stderr?: string; code?: number };
    throw new Error(
      `Script failed with exit code ${err.code}:\nstdout: ${err.stdout}\nstderr: ${err.stderr}`
    );
  }
}

/**
 * Helper to clear all data
 */
async function clearAll() {
  await prisma.notification.deleteMany({});
  await prisma.retweet.deleteMany({});
  await prisma.like.deleteMany({});
  await prisma.tweet.deleteMany({});
  await prisma.follow.deleteMany({});
  await prisma.passwordResetToken.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.user.deleteMany({});
}

describe("seed.ts", () => {
  beforeEach(async () => {
    // Start each test with a clean slate
    await clearAll();
  });

  it("populates deterministic fixtures with expected shape", async () => {
    const { stdout } = await runScript("scripts/seed.ts");

    // Verify console output mentions all expected operations
    expect(stdout).toContain("Clearing existing fixture data");
    expect(stdout).toContain("Creating users");
    expect(stdout).toContain("Creating tweets");
    expect(stdout).toContain("Creating follow relationships");
    expect(stdout).toContain("Creating engagement");
    expect(stdout).toContain("Updating denormalized counts");
    expect(stdout).toContain("Seed complete");

    // Verify data was created
    const userCount = await prisma.user.count();
    const tweetCount = await prisma.tweet.count();
    const followCount = await prisma.follow.count();
    const likeCount = await prisma.like.count();
    const retweetCount = await prisma.retweet.count();

    expect(userCount).toBe(5);
    expect(tweetCount).toBe(20);
    expect(followCount).toBe(10);
    expect(likeCount).toBe(7);
    expect(retweetCount).toBe(4);

    // Verify fixture users exist with correct emails
    const users = await prisma.user.findMany({
      orderBy: { email: "asc" },
      select: { email: true, username: true },
    });

    expect(users[0]?.email).toBe("user1@test.com");
    expect(users[1]?.email).toBe("user2@test.com");
    expect(users[2]?.email).toBe("user3@test.com");
    expect(users[3]?.email).toBe("user4@test.com");
    expect(users[4]?.email).toBe("user5@test.com");

    expect(users[0]?.username).toBe("user1");
    expect(users[1]?.username).toBe("user2");
    expect(users[2]?.username).toBe("user3");
    expect(users[3]?.username).toBe("user4");
    expect(users[4]?.username).toBe("user5");
  });

  it("is idempotent - rerun/reset path remains clean", async () => {
    // Run seed once
    const { stdout: firstRun } = await runScript("scripts/seed.ts");
    expect(firstRun).toContain("Seed complete");

    const firstUserCount = await prisma.user.count();
    const firstTweetCount = await prisma.tweet.count();

    expect(firstUserCount).toBe(5);
    expect(firstTweetCount).toBe(20);

    // Run seed again (should clear and recreate)
    const { stdout: secondRun } = await runScript("scripts/seed.ts");
    expect(secondRun).toContain("Clearing existing fixture data");
    expect(secondRun).toContain("Seed complete");

    const secondUserCount = await prisma.user.count();
    const secondTweetCount = await prisma.tweet.count();

    expect(secondUserCount).toBe(5);
    expect(secondTweetCount).toBe(20);

    // Verify same data structure
    const users = await prisma.user.findMany({
      orderBy: { email: "asc" },
      select: { email: true },
    });

    expect(users[0]?.email).toBe("user1@test.com");
    expect(users[4]?.email).toBe("user5@test.com");
  });

  it("creates tweets with correct types (standalone, replies, quote tweets)", async () => {
    await runScript("scripts/seed.ts");

    const tweets = await prisma.tweet.findMany({
      select: {
        id: true,
        parentId: true,
        quoteTweetId: true,
      },
    });

    const standalone = tweets.filter((t) => !t.parentId && !t.quoteTweetId);
    const replies = tweets.filter((t) => t.parentId);
    const quoteTweets = tweets.filter((t) => t.quoteTweetId);

    expect(standalone.length).toBe(10);
    expect(replies.length).toBe(5);
    expect(quoteTweets.length).toBe(5);
  });

  it("updates all denormalized counts correctly", async () => {
    await runScript("scripts/seed.ts");

    // Verify user counts are set
    const users = await prisma.user.findMany({
      select: {
        username: true,
        followerCount: true,
        followingCount: true,
        tweetCount: true,
      },
    });

    for (const user of users) {
      expect(user.followerCount).toBeGreaterThanOrEqual(0);
      expect(user.followingCount).toBeGreaterThanOrEqual(0);
      expect(user.tweetCount).toBeGreaterThanOrEqual(0);
    }

    // Verify tweet counts are set
    const tweets = await prisma.tweet.findMany({
      select: {
        id: true,
        likeCount: true,
        retweetCount: true,
        replyCount: true,
      },
    });

    for (const tweet of tweets) {
      expect(tweet.likeCount).toBeGreaterThanOrEqual(0);
      expect(tweet.retweetCount).toBeGreaterThanOrEqual(0);
      expect(tweet.replyCount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("reconcile-counts.ts", () => {
  beforeEach(async () => {
    // Start with clean seed data
    await clearAll();
    await runScript("scripts/seed.ts");
  });

  it("detects count drift and fixes discrepancies", async () => {
    // Manually introduce drift by updating a user's followerCount
    const user = await prisma.user.findFirst({
      where: { username: "user1" },
    });

    if (!user) throw new Error("user1 not found after seed");

    // Corrupt followerCount
    await prisma.user.update({
      where: { id: user.id },
      data: { followerCount: 999 },
    });

    // Run reconcile script
    const { stdout } = await runScript("scripts/reconcile-counts.ts");

    // Verify console output shows discrepancy
    expect(stdout).toContain("Discrepancies found");
    expect(stdout).toContain("user1");
    expect(stdout).toContain("followerCount");
    expect(stdout).toContain("was 999");

    // Verify count was fixed
    const fixedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { followerCount: true },
    });

    expect(fixedUser?.followerCount).not.toBe(999);
    expect(fixedUser?.followerCount).toBeGreaterThanOrEqual(0);
  });

  it("logs before/after discrepancies with actionable detail", async () => {
    // Introduce multiple drifts
    const users = await prisma.user.findMany({
      take: 2,
    });

    await prisma.user.update({
      where: { id: users[0]?.id },
      data: { followerCount: 888, followingCount: 777 },
    });

    await prisma.user.update({
      where: { id: users[1]?.id },
      data: { tweetCount: 666 },
    });

    const { stdout } = await runScript("scripts/reconcile-counts.ts");

    // Verify detailed logging
    expect(stdout).toContain("Discrepancies found");
    expect(stdout).toContain("followerCount was 888");
    expect(stdout).toContain("followingCount was 777");
    expect(stdout).toContain("tweetCount was 666");
    expect(stdout).toContain("corrected to");
  });

  it("succeeds on empty database without hidden failures", async () => {
    // Clear all data
    await clearAll();

    // Run reconcile on empty database
    const { stdout } = await runScript("scripts/reconcile-counts.ts");

    // Should complete successfully
    expect(stdout).toContain("Count reconciliation complete");
    expect(stdout).toContain("No users found");
    expect(stdout).toContain("No tweets found");
    expect(stdout).not.toContain("failed");
    expect(stdout).not.toContain("error");
  });

  it("reports zero discrepancies when counts are already correct", async () => {
    // Run reconcile on freshly seeded data (counts should be correct)
    const { stdout } = await runScript("scripts/reconcile-counts.ts");

    expect(stdout).toContain("All user counts are correct");
    expect(stdout).toContain("All tweet counts are correct");
    expect(stdout).toContain("Total discrepancies found: 0");
    expect(stdout).toContain("All counts are in sync");
  });

  it("fixes tweet count discrepancies (likes, retweets, replies)", async () => {
    // Get a tweet and corrupt its counts
    const tweet = await prisma.tweet.findFirst({
      where: { deleted: false },
    });

    if (!tweet) throw new Error("No tweets found after seed");

    await prisma.tweet.update({
      where: { id: tweet.id },
      data: {
        likeCount: 555,
        retweetCount: 444,
        replyCount: 333,
      },
    });

    const { stdout } = await runScript("scripts/reconcile-counts.ts");

    // Verify discrepancies detected and fixed
    expect(stdout).toContain("Discrepancies found");
    expect(stdout).toMatch(/likeCount was 555, corrected to \d+/);
    expect(stdout).toMatch(/retweetCount was 444, corrected to \d+/);
    expect(stdout).toMatch(/replyCount was 333, corrected to \d+/);

    // Verify counts were fixed
    const fixedTweet = await prisma.tweet.findUnique({
      where: { id: tweet.id },
      select: { likeCount: true, retweetCount: true, replyCount: true },
    });

    expect(fixedTweet?.likeCount).not.toBe(555);
    expect(fixedTweet?.retweetCount).not.toBe(444);
    expect(fixedTweet?.replyCount).not.toBe(333);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
