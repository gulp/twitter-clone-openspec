# Batch Engagement State Check

## What

When hydrating a list of tweets for an authenticated user, the system checks whether the user has liked or retweeted each tweet using two batched database queries instead of N individual subqueries. This prevents N+1 query performance issues and ensures O(1) lookup time during annotation.

## Where

The pattern is implemented in 4 locations:

- `src/server/services/feed.ts:316-330` — assembleFeed service function
- `src/server/trpc/routers/feed.ts:115-135` — getHomeFeed procedure
- `src/server/trpc/routers/search.ts:183-201` — searchTweets procedure
- `src/server/trpc/routers/tweet.ts:477-495` — getReplies procedure (also used in getUserLikes)

## How It Works

### Step 1: Extract Tweet IDs

Collect all tweet IDs that need engagement state annotation:

```typescript
const tweetIds = tweets.map((t) => t.id);
```

### Step 2: Execute Two Parallel Batch Queries

Use `Promise.all` to execute two independent queries simultaneously:

```typescript
const [likedTweetIds, retweetedTweetIds] = await Promise.all([
  prisma.like
    .findMany({
      where: { userId, tweetId: { in: tweetIds } },
      select: { tweetId: true },
    })
    .then((likes) => new Set(likes.map((l) => l.tweetId))),
  prisma.retweet
    .findMany({
      where: { userId, tweetId: { in: tweetIds } },
      select: { tweetId: true },
    })
    .then((retweets) => new Set(retweets.map((r) => r.tweetId))),
]);
```

Both queries use Prisma's `{ in: tweetIds }` syntax, which translates to SQL's `ANY($1::text[])` array parameter. This executes as **exactly two queries** regardless of the number of tweets.

### Step 3: Convert to Sets for O(1) Lookup

Results are immediately converted to `Set<string>` using `.then()` in the Promise chain. This enables O(1) membership testing during annotation.

### Step 4: Annotate Tweets

For each tweet, check membership in both sets:

```typescript
const annotatedTweets = tweets.map((tweet) => ({
  ...tweet,
  hasLiked: likedTweetIds.has(tweet.id),
  hasRetweeted: retweetedTweetIds.has(tweet.id),
}));
```

### Edge Case: Unauthenticated Users

For unauthenticated requests, the batch queries are skipped entirely and all tweets are annotated with `hasLiked: false`, `hasRetweeted: false`:

```typescript
// src/server/trpc/routers/feed.ts:115-135
let likesMap = new Map<string, boolean>();
let retweetsMap = new Map<string, boolean>();

if (ctx.session?.user?.id) {
  const currentUserId = ctx.session.user.id;
  const tweetIds = items.map((item) => item.tweet.id);

  if (tweetIds.length > 0) {
    const [likes, retweets] = await Promise.all([/* ... */]);
    likesMap = new Map(likes.map((like) => [like.tweetId, true]));
    retweetsMap = new Map(retweets.map((rt) => [rt.tweetId, true]));
  }
}

// Later: Map.get() with fallback to false
hasLiked: likesMap.get(item.tweet.id) ?? false,
hasRetweeted: retweetsMap.get(item.tweet.id) ?? false,
```

### Edge Case: Empty Tweet List

When `tweetIds.length === 0`, some implementations skip the batch queries entirely (feed.ts, tweet.ts use conditional `if (tweetIds.length > 0)`), while others allow the queries to execute with an empty IN clause (returns 0 rows). Both approaches are safe.

## Invariants

**I1: Always Two Queries**
The pattern executes exactly two queries for any non-zero tweet count. Never 0 queries (N+1 avoided), never 1 query (separate Like/Retweet tables require separate queries), never >2 queries.

**I2: Set Conversion Required**
Results MUST be converted to `Set<string>`, not kept as arrays. Annotation loops iterate over potentially hundreds of tweets; array `.includes()` would be O(N²), Set `.has()` is O(N).

**I3: Parallel Execution**
Like and Retweet queries are independent and MUST execute in parallel via `Promise.all`, not sequentially with `await`. This halves the round-trip latency.

**I4: Select Only tweetId**
Queries select only `{ tweetId: true }`. Other columns (userId, createdAt) are unnecessary for annotation and would waste bandwidth.

**I5: Annotation is Client-Side**
The database queries return raw membership data. Annotation (merging engagement state with tweet objects) happens in application code, not via SQL JOINs. This keeps the tweet fetch query simple and reusable.

## Gotchas

**G1: Why Two Queries Instead of One JOIN?**
The system could theoretically use a single query with a UNION or join across both Like and Retweet tables. However:
- Prisma does not support raw SQL `ANY()` in typed `where` clauses with aggregated results.
- Two separate queries are simpler, more readable, and equally fast (both execute in parallel).
- The plan (§1.16) explicitly specifies this two-query pattern.

**G2: Map vs Set Inconsistency**
Some implementations use `Map<string, boolean>` (feed.ts:121-135, search.ts:183-201), others use `Set<string>` (feed.ts:317-330, tweet.ts:482-494). Both work identically for boolean flags:
- `Set.has(tweetId)` returns `true` if present, `false` if absent.
- `Map.get(tweetId) ?? false` returns `true` if present, `false` if absent or undefined.

The Set pattern is preferred for clarity (no need for `?? false` fallback), but both are correct.

**G3: Why Not Hydrate in SQL?**
The batch queries could be replaced with a complex SQL query that left-joins likes and retweets during the initial tweet fetch. This was rejected because:
- Prisma does not support conditional left joins with aggregation in a type-safe way.
- The current pattern is simpler to test and debug.
- Two small queries + in-memory annotation is faster than one large query with multiple joins (tested in §9 performance benchmarks, not documented).

**G4: Empty IN Clause Behavior**
PostgreSQL and Prisma both handle `WHERE tweetId IN ([])` (empty array) gracefully—it returns 0 rows. Some code paths check `if (tweetIds.length > 0)` before querying, others do not. Both are correct; the conditional check is a micro-optimization to avoid a no-op query.

**G5: Deduplication with Retweets**
When feed items include retweeted content, the `tweetIds` array may contain duplicates (same tweet ID appears as both original and retweet). The `{ in: tweetIds }` clause inherently deduplicates at the SQL level, and Set conversion further ensures uniqueness.

**G6: No Caching of Engagement State**
Unlike feed items (which are cached in Redis), engagement state is **never cached**. It is always fetched live from the database. This ensures users immediately see their own like/retweet actions reflected, even if the feed cache is stale.
