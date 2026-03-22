# Integration Test Helpers

## What

Test utilities for creating authenticated tRPC callers, seeding test data, and isolating test state. These helpers provide deterministic test setup with proper database cleanup and Redis key isolation to prevent cross-test pollution.

## Where

Primary implementation: `tests/integration/helpers.ts:1-288`

Usage examples:
- `tests/integration/tweet.test.ts:1-318` — tweet router tests
- `tests/integration/auth.test.ts` — auth flow tests
- `tests/integration/social.test.ts` — follow/unfollow tests
- `tests/integration/engagement.test.ts` — like/retweet tests
- `tests/integration/feed.test.ts` — feed assembly tests

## How It Works

### Test User Creation

`createTestUser()` generates users with bcrypt-hashed passwords and returns both the user object and plaintext password for login tests:

```typescript
// tests/integration/helpers.ts:30-61
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
```

Usage in tests:

```typescript
// tests/integration/tweet.test.ts:27-28
const { user } = await createTestUser();
const caller = createTestContext(user.id);
```

### Test Tweet Creation

`createTestTweet()` creates tweets and maintains denormalized counts (increments `user.tweetCount`, `parent.replyCount`):

```typescript
// tests/integration/helpers.ts:70-98
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
```

### tRPC Context Creation

`createTestContext()` creates a tRPC caller with an authenticated session and unique IP address to avoid rate limit collisions:

```typescript
// tests/integration/helpers.ts:107-144
export function createTestContext(userId?: string, ip?: string) {
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

  // Use unique IP per test by default to avoid rate limit collisions
  // This simulates different clients making requests
  const testIp = ip || `10.0.0.${Math.floor(Math.random() * 255)}`;

  // Create mock request object
  const req = new Request("http://localhost:3000/api/trpc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": testIp,
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
```

The caller can invoke any tRPC procedure:

```typescript
// tests/integration/tweet.test.ts:30-37
const tweet = await caller.tweet.create({
  content: "Hello, world!",
  mediaUrls: [],
});

expect(tweet.id).toBeDefined();
expect(tweet.content).toBe("Hello, world!");
expect(tweet.authorId).toBe(user.id);
```

### Database Cleanup

`cleanupDatabase()` deletes all test data in reverse dependency order to avoid foreign key violations:

```typescript
// tests/integration/helpers.ts:150-161
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
```

Call in `beforeEach`/`afterEach` hooks:

```typescript
// tests/integration/tweet.test.ts:17-23
beforeEach(async () => {
  await cleanupDatabase();
});

afterEach(async () => {
  await cleanupDatabase();
});
```

### Redis Key Isolation

`getTestRedisPrefix()` generates a unique prefix for each test to prevent cross-test pollution. `cleanupRedis()` flushes keys by prefix:

```typescript
// tests/integration/helpers.ts:20-22
export function getTestRedisPrefix(testId?: string): string {
  return `test:${testId || randomUUID()}:`;
}

// tests/integration/helpers.ts:167-177
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
```

Usage pattern:

```typescript
let testPrefix: string;

beforeEach(() => {
  testPrefix = getTestRedisPrefix();
});

afterEach(async () => {
  await cleanupRedis(testPrefix);
});

// Inside test, use prefixed keys:
await redis.set(`${testPrefix}user:${userId}:session`, sessionData);
```

### Log Capture for Assertions

`LogCapture` intercepts structured JSON logs for asserting logging behavior:

```typescript
// tests/integration/helpers.ts:183-288
export class LogCapture {
  private logs: Array<{ level: string; msg: string; data: Record<string, unknown> }> = [];

  start() {
    this.logs = [];
    // Intercepts console.log/warn/error and parses JSON
  }

  stop() {
    // Restores original console methods
  }

  getLogs() {
    return this.logs;
  }

  getLogsByLevel(level: "info" | "warn" | "error") {
    return this.logs.filter((log) => log.level === level);
  }

  getLogsByRequestId(requestId: string) {
    return this.logs.filter((log) => log.data.requestId === requestId);
  }

  getLogsByMessage(pattern: string | RegExp) {
    return this.logs.filter((log) =>
      typeof pattern === "string" ? log.msg.includes(pattern) : pattern.test(log.msg)
    );
  }
}
```

Usage:

```typescript
const logCapture = new LogCapture();
logCapture.start();

// Perform action that logs
await caller.auth.login({ email: "wrong@test.com", password: "wrong" });

logCapture.stop();

const warnLogs = logCapture.getLogsByLevel("warn");
expect(warnLogs.some(log => log.msg.includes("Invalid credentials"))).toBe(true);
```

## Invariants

1. **Test user emails must be unique** — always use CUID-based emails (`test-${id}@example.com`) or timestamp suffixes to prevent conflicts across parallel tests.

2. **Each test gets a unique IP** — `createTestContext()` randomizes IP by default (`10.0.0.${random}`) to prevent rate limit collisions when tests run in parallel.

3. **Database cleanup order is strict** — `cleanupDatabase()` must delete in reverse dependency order (child → parent) to avoid foreign key violations. Notifications and Retweets before Tweets, Tweets before Users.

4. **Redis key prefixes are mandatory** — all Redis operations in tests must use `getTestRedisPrefix()` to prevent cross-test pollution. Never use bare keys like `user:123:session` in tests.

5. **Cleanup runs in both hooks** — call `cleanupDatabase()` in both `beforeEach` (for deterministic start state) and `afterEach` (for cleanup). Tests may be skipped, so relying only on `afterEach` can leak state.

6. **Test tweets maintain denormalized counts** — `createTestTweet()` increments `user.tweetCount` and `parent.replyCount` to match production behavior. Do NOT create tweets via raw Prisma in tests without maintaining counts.

7. **Passwords are hashed at creation** — `createTestUser()` always hashes passwords with bcrypt (12 rounds) to match production. Never insert raw passwords into `user.hashedPassword`.

8. **Redis cleanup is fail-open** — `cleanupRedis()` catches and logs errors but does not throw. Tests continue even if Redis is unavailable (matches production fail-open policy for caching).

## Gotchas

**Parallel test isolation:** Vitest runs tests in parallel by default. Without unique prefixes, tests can collide on Redis keys or rate limits. Always use `getTestRedisPrefix()` for Redis and rely on `createTestContext()` IP randomization.

**Foreign key cleanup order:** If you add a new table with foreign keys, update `cleanupDatabase()` to delete it in the correct order. Otherwise, tests will fail with FK constraint violations.

**Count drift:** If tests create tweets via raw Prisma (`prisma.tweet.create()`) instead of `createTestTweet()`, denormalized counts will drift and assertions like `expect(user.tweetCount).toBe(2)` will fail. Always use helpers to maintain invariants.

**Session expiry:** `createTestContext()` generates sessions expiring in 30 days. If tests need expired sessions, override the `expires` field manually.

**Rate limit test conflicts:** If testing rate limits, provide an explicit IP to `createTestContext(userId, "192.168.1.100")` to ensure multiple requests hit the same rate limit bucket. Default random IPs bypass rate limits.

**Log capture timing:** Call `logCapture.start()` before the operation that logs, and `logCapture.stop()` before assertions. Logs generated outside this window are not captured.

**Structured log format:** `LogCapture` only captures JSON-formatted logs with `{ level, msg, ... }` shape. Plain `console.log("text")` calls are ignored. All production code uses structured logging, so this matches reality.

**Test database name:** Integration tests assume `DATABASE_URL` points to a test database (e.g., `twitter_clone_test`). Never run integration tests against the production database.
