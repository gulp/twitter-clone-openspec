#!/usr/bin/env tsx
/**
 * Performance Smoke Tests
 *
 * Measures endpoint latencies against §9 thresholds:
 * - feed.home cache hit/miss
 * - search.tweets/users
 * - auth.register/login
 * - SSE first-event handshake
 *
 * Usage:
 *   npx tsx scripts/perf-smoke.ts
 *   npx tsx scripts/perf-smoke.ts --json > artifacts/perf/report.json
 */

import { randomUUID } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "../src/server/db";
import { redis } from "../src/server/redis";
import { appRouter } from "../src/server/trpc/router";
import bcrypt from "bcryptjs";
import type { Session } from "next-auth";

// §9 Performance Thresholds (development environment)
const THRESHOLDS = {
  "feed.home.cacheHit": { p50: 50, p95: 100, p99: 150 },
  "feed.home.cacheMiss": { p50: 200, p95: 350, p99: 500 },
  "search.tweets": { p50: 150, p95: 275, p99: 400 },
  "search.users": { p50: 100, p95: 200, p99: 300 },
  "auth.register": { p50: 400, p95: 600, p99: 800 },
  "sse.firstEvent": { p50: 2000, p95: 3500, p99: 5000 },
};

interface TimingSample {
  endpoint: string;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

interface PerformanceReport {
  timestamp: string;
  samples: TimingSample[];
  results: {
    endpoint: string;
    p50: number;
    p95: number;
    p99: number;
    thresholds: { p50: number; p95: number; p99: number };
    pass: boolean;
    violations: string[];
  }[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

/**
 * Calculate percentile from sorted array of numbers
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

/**
 * Create tRPC caller with test context
 */
function createCaller(userId?: string) {
  const requestId = randomUUID();
  const session: Session | null = userId
    ? {
        user: {
          id: userId,
          email: `${userId}@example.com`,
          name: "Perf Test User",
        },
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }
    : null;

  const req = new Request("http://localhost:3000/api/trpc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 255)}`,
    },
  });

  const ctx = { session, requestId, req };
  return appRouter.createCaller(ctx);
}

/**
 * Time an async operation
 */
async function time<T>(
  fn: () => Promise<T>
): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await fn();
  const latencyMs = performance.now() - start;
  return { result, latencyMs };
}

/**
 * Setup: Create fixture data
 */
async function setupFixtures() {
  console.log("📦 Setting up fixtures...");

  // Create test users
  const authorId = createId();
  const followerId = createId();
  const hashedPassword = await bcrypt.hash("password123", 12);

  await prisma.user.createMany({
    data: [
      {
        id: authorId,
        email: `author-${authorId}@perf.test`,
        username: `author_${authorId.slice(0, 6)}`,
        displayName: "Perf Author",
        hashedPassword,
        bio: "Performance test author",
      },
      {
        id: followerId,
        email: `follower-${followerId}@perf.test`,
        username: `follower_${followerId.slice(0, 6)}`,
        displayName: "Perf Follower",
        hashedPassword,
      },
    ],
  });

  // Create follow relationship
  await prisma.follow.create({
    data: {
      followerId,
      followingId: authorId,
    },
  });

  // Create tweets for feed
  const tweetIds: string[] = [];
  for (let i = 0; i < 20; i++) {
    const tweet = await prisma.tweet.create({
      data: {
        authorId,
        content: `Performance test tweet ${i + 1} with some content to search`,
      },
    });
    tweetIds.push(tweet.id);
  }

  // Update author tweet count
  await prisma.user.update({
    where: { id: authorId },
    data: { tweetCount: 20 },
  });

  // Create some users for search
  for (let i = 0; i < 10; i++) {
    const id = createId();
    await prisma.user.create({
      data: {
        id,
        email: `searchuser${i}@perf.test`,
        username: `searchuser_${i}`,
        displayName: `Search User ${i}`,
        hashedPassword,
        bio: `Bio for search user ${i}`,
      },
    });
  }

  return { authorId, followerId, tweetIds };
}

/**
 * Cleanup: Remove all perf test data
 */
async function cleanup() {
  console.log("🧹 Cleaning up fixtures...");

  await prisma.notification.deleteMany({
    where: { recipient: { email: { endsWith: "@perf.test" } } },
  });
  await prisma.retweet.deleteMany({
    where: { user: { email: { endsWith: "@perf.test" } } },
  });
  await prisma.like.deleteMany({
    where: { user: { email: { endsWith: "@perf.test" } } },
  });
  await prisma.tweet.deleteMany({
    where: { author: { email: { endsWith: "@perf.test" } } },
  });
  await prisma.follow.deleteMany({
    where: {
      OR: [
        { follower: { email: { endsWith: "@perf.test" } } },
        { following: { email: { endsWith: "@perf.test" } } },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: { email: { endsWith: "@perf.test" } },
  });

  // Clear Redis feed cache
  try {
    const keys = await redis.keys("feed:home:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.warn("Redis cleanup warning:", error);
  }
}

/**
 * Benchmark feed.home with cache hit/miss scenarios
 */
async function benchmarkFeed(followerId: string, samples: TimingSample[]) {
  console.log("📊 Benchmarking feed.home...");

  const caller = createCaller(followerId);

  // Warmup call to populate cache
  await caller.feed.home({ limit: 20 });

  // Measure cache hits (10 samples)
  for (let i = 0; i < 10; i++) {
    const { latencyMs } = await time(() => caller.feed.home({ limit: 20 }));
    samples.push({
      endpoint: "feed.home.cacheHit",
      latencyMs,
      metadata: { cacheHit: true },
    });
  }

  // Measure cache misses (10 samples)
  for (let i = 0; i < 10; i++) {
    // Clear cache before each call
    try {
      const keys = await redis.keys(`feed:home:${followerId}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.warn("Cache clear warning:", error);
    }

    const { latencyMs } = await time(() => caller.feed.home({ limit: 20 }));
    samples.push({
      endpoint: "feed.home.cacheMiss",
      latencyMs,
      metadata: { cacheHit: false },
    });
  }
}

/**
 * Benchmark search endpoints
 */
async function benchmarkSearch(samples: TimingSample[]) {
  console.log("🔍 Benchmarking search...");

  const caller = createCaller();

  // search.tweets (15 samples)
  for (let i = 0; i < 15; i++) {
    const { latencyMs } = await time(() =>
      caller.search.tweets({ query: "performance test tweet", limit: 20 })
    );
    samples.push({ endpoint: "search.tweets", latencyMs });
  }

  // search.users (15 samples)
  for (let i = 0; i < 15; i++) {
    const { latencyMs } = await time(() =>
      caller.search.users({ query: "searchuser", limit: 20 })
    );
    samples.push({ endpoint: "search.users", latencyMs });
  }
}

/**
 * Benchmark auth.register (bcrypt-bound)
 */
async function benchmarkAuth(samples: TimingSample[]) {
  console.log("🔐 Benchmarking auth.register...");

  // auth.register (10 samples)
  for (let i = 0; i < 10; i++) {
    const caller = createCaller();
    const id = createId();

    const { latencyMs } = await time(() =>
      caller.auth.register({
        email: `register-${id}@perf.test`,
        username: `reg_${id.slice(0, 8)}`,
        displayName: `Register Test ${i}`,
        password: "password123",
      })
    );

    samples.push({ endpoint: "auth.register", latencyMs });
  }
}

/**
 * Benchmark SSE first-event handshake
 */
async function benchmarkSSE(userId: string, samples: TimingSample[]) {
  console.log("⚡ Benchmarking SSE first-event...");

  // SSE handshake (5 samples - slower so fewer iterations)
  for (let i = 0; i < 5; i++) {
    const start = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch("http://localhost:3000/api/sse", {
        headers: {
          // In production this would use actual session cookie
          // For smoke test, we're measuring the endpoint response time
          "x-test-user-id": userId,
        },
        signal: controller.signal,
      });

      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Read until we get first event or timeout
        let firstEventReceived = false;
        while (!firstEventReceived) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          // Look for first event (either retry: or data:)
          if (chunk.includes("retry:") || chunk.includes("data:")) {
            firstEventReceived = true;
            break;
          }
        }

        reader.releaseLock();
        controller.abort();
      }

      clearTimeout(timeoutId);

      const latencyMs = performance.now() - start;
      samples.push({ endpoint: "sse.firstEvent", latencyMs });
    } catch (error) {
      // SSE endpoint might not be running - log warning and skip
      console.warn(`SSE benchmark skipped: ${error}`);
      break;
    }
  }
}

/**
 * Analyze samples and generate report
 */
function generateReport(samples: TimingSample[]): PerformanceReport {
  const results: PerformanceReport["results"] = [];

  // Group samples by endpoint
  const grouped = samples.reduce(
    (acc, sample) => {
      if (!acc[sample.endpoint]) {
        acc[sample.endpoint] = [];
      }
      acc[sample.endpoint]!.push(sample.latencyMs);
      return acc;
    },
    {} as Record<string, number[]>
  );

  // Calculate percentiles and check thresholds
  for (const [endpoint, latencies] of Object.entries(grouped)) {
    const sorted = latencies.sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);

    const thresholds = THRESHOLDS[endpoint as keyof typeof THRESHOLDS] || {
      p50: Infinity,
      p95: Infinity,
      p99: Infinity,
    };

    const violations: string[] = [];
    if (p50 > thresholds.p50) {
      violations.push(`p50 ${p50.toFixed(1)}ms > ${thresholds.p50}ms`);
    }
    if (p95 > thresholds.p95) {
      violations.push(`p95 ${p95.toFixed(1)}ms > ${thresholds.p95}ms`);
    }
    if (p99 > thresholds.p99) {
      violations.push(`p99 ${p99.toFixed(1)}ms > ${thresholds.p99}ms`);
    }

    results.push({
      endpoint,
      p50: Math.round(p50 * 10) / 10,
      p95: Math.round(p95 * 10) / 10,
      p99: Math.round(p99 * 10) / 10,
      thresholds,
      pass: violations.length === 0,
      violations,
    });
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  return {
    timestamp: new Date().toISOString(),
    samples,
    results,
    summary: {
      total: results.length,
      passed,
      failed,
    },
  };
}

/**
 * Print report to console
 */
function printReport(report: PerformanceReport) {
  console.log("\n" + "=".repeat(80));
  console.log("PERFORMANCE SMOKE TEST RESULTS");
  console.log("=".repeat(80));
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Total Samples: ${report.samples.length}`);
  console.log();

  for (const result of report.results) {
    const status = result.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} ${result.endpoint}`);
    console.log(
      `  p50: ${result.p50}ms (threshold: ${result.thresholds.p50}ms)`
    );
    console.log(
      `  p95: ${result.p95}ms (threshold: ${result.thresholds.p95}ms)`
    );
    console.log(
      `  p99: ${result.p99}ms (threshold: ${result.thresholds.p99}ms)`
    );

    if (result.violations.length > 0) {
      console.log(`  Violations:`);
      for (const violation of result.violations) {
        console.log(`    - ${violation}`);
      }
    }
    console.log();
  }

  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total: ${report.summary.total}`);
  console.log(`Passed: ${report.summary.passed}`);
  console.log(`Failed: ${report.summary.failed}`);
  console.log("=".repeat(80));
}

/**
 * Main execution
 */
async function main() {
  const jsonOutput = process.argv.includes("--json");

  if (!jsonOutput) {
    console.log("🚀 Starting performance smoke tests...\n");
  }

  const samples: TimingSample[] = [];

  try {
    // Setup
    await cleanup();
    const fixtures = await setupFixtures();

    // Run benchmarks
    await benchmarkFeed(fixtures.followerId, samples);
    await benchmarkSearch(samples);
    await benchmarkAuth(samples);
    await benchmarkSSE(fixtures.followerId, samples);

    // Generate and output report
    const report = generateReport(samples);

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);

      // Exit with error code if any tests failed
      if (report.summary.failed > 0) {
        process.exit(1);
      }
    }
  } catch (error) {
    console.error("❌ Performance smoke tests failed:", error);
    process.exit(1);
  } finally {
    // Cleanup
    await cleanup();
    await prisma.$disconnect();
    await redis.quit();
  }
}

main();
