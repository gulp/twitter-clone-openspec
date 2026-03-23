# Quote Tweet Design

## What

Quote tweets allow users to create a new tweet that references an existing tweet via `quoteTweetId`. Unlike retweets (which are relationship records), quote tweets are **full Tweet entities** with their own content, media, engagement counts, and author. The quoted tweet's author receives a QUOTE_TWEET notification.

Key design decision: **Quote tweets do NOT increment any denormalized count on the original tweet.** There is no `quoteCount` field. Quote tweets are standalone content, not engagement metrics.

## Where

**Schema:**
- `prisma/schema.prisma:46` — `quoteTweetId String?` (nullable foreign key)
- `prisma/schema.prisma:61-62` — Self-referential relation `quotedTweet`/`quotedBy`

**Mutation:**
- `src/server/trpc/routers/engagement.ts:304-400` — `quoteTweet` procedure

**Hydration:**
- `src/server/services/feed.ts:298` — `quoteTweetId` selected but **not hydrated**
- Feed items include `quoteTweetId: string | null` but do not include the full quoted tweet object

**Notification:**
- `src/server/trpc/routers/engagement.ts:392-397` — `QUOTE_TWEET` notification sent to original author

## How It Works

### Mutation Flow (engagement.ts:304-400)

```typescript
// Input validation
quoteTweet: protectedProcedure
  .input(z.object({
    content: tweetContentSchema.optional(),
    mediaUrls: z.array(z.string().url()).max(4).optional(),
    quoteTweetId: z.string(),
  }))
```

1. **Validate content or media present** (line 317-322): Quote tweets must have text OR media (I7 invariant)
2. **Validate media URLs** (line 325-327): If media present, verify ownership via `validateMediaUrls`
3. **Verify quoted tweet exists and not deleted** (line 330-347):
   ```typescript
   const quotedTweet = await prisma.tweet.findUnique({
     where: { id: quoteTweetId },
     select: { id: true, deleted: true, authorId: true },
   });
   // Throw NOT_FOUND if missing, BAD_REQUEST if deleted
   ```
4. **Transaction: create tweet + increment user.tweetCount** (line 349-376):
   - Creates new Tweet with `quoteTweetId` field set
   - Increments author's `tweetCount` (I3 invariant)
   - **Does NOT touch the quoted tweet's counts** (no `quoteCount` field exists)
5. **Send notification** (line 392-397):
   - Fire `QUOTE_TWEET` notification to `quotedTweet.authorId`
   - Self-suppression handled by `createNotification` (author quoting own tweet = no notification)

### Feed Assembly Behavior

Unlike retweets:
- **No feed version bump**: Quoting a tweet does NOT call `bumpFeedVersionForFollowers`
- Quote tweets appear in the author's followers' feeds via normal tweet creation
- The **quoter's** followers see the quote tweet; the **original author's** followers do NOT

**Hydration (feed.ts:298):**
```typescript
select: {
  id: true,
  content: true,
  // ...
  quoteTweetId: true,  // ← Selected but not hydrated
  // ...
}
```

The feed returns `quoteTweetId: string | null` but **does not include the full quoted tweet object**. Frontend must:
- Display the quote tweet ID
- Optionally fetch the quoted tweet separately (not batched)

**Known gap:** No spec exists for how frontend should handle `quoteTweetId` (fetch separately? embed? lazy load?).

## Invariants

**I-QUOTE1**: Quote tweets are full Tweet entities with their own `id`, `content`, `mediaUrls`, and engagement counts.

**I-QUOTE2**: The original tweet's counts (likeCount, retweetCount, replyCount) are **never modified** by quote tweets.

**I-QUOTE3**: Quoting a deleted tweet throws `BAD_REQUEST` (enforcement at mutation time, line 342-347).

**I-QUOTE4**: Quote tweets require content OR media (same as regular tweets, I7).

**I-QUOTE5**: Quote tweet creation is atomic: tweet creation + `user.tweetCount` increment succeed or fail together (line 376 `$transaction`).

**I-QUOTE6**: `quoteTweetId` is nullable — regular tweets and replies have `quoteTweetId = null`.

**I-QUOTE7**: Self-referential quotes are allowed (you can quote your own tweet). Notification is suppressed by `createNotification` self-suppression logic.

## Gotchas

**G-QUOTE1: No denormalized quote count.**
Unlike likes (`likeCount`), retweets (`retweetCount`), and replies (`replyCount`), there is **no `quoteCount` field** on Tweet. To count how many times a tweet has been quoted:
```typescript
await prisma.tweet.count({
  where: { quoteTweetId: originalTweetId, deleted: false }
})
```
This is an **unbounded query** — no pagination, no index optimization (only `quoteTweetId` in relations, not indexed).

**G-QUOTE2: Quote tweets do not bump feed versions.**
Creating a quote tweet:
- ✓ Appears in the quoter's followers' feeds (via normal tweet creation flow)
- ✗ Does NOT appear in the original tweet author's followers' feeds
- ✗ Does NOT call `bumpFeedVersionForFollowers`

This differs from retweets, which DO bump feed versions and appear in followers' feeds.

**G-QUOTE3: Quoted tweet not hydrated in feed assembly.**
Feed items return `quoteTweetId: string | null`, but the full quoted tweet object is **not included**. Frontend must:
- Check if `quoteTweetId` is present
- Fetch the quoted tweet separately (or batch multiple fetches)

**Unresolved:** No spec or implementation exists for batched quoted tweet hydration. Current code would require N additional queries for a feed with N quote tweets.

**G-QUOTE4: Deleted quote tweet chain handling.**
If Tweet A is quoted by Tweet B, then Tweet A is deleted:
- Tweet B still exists with `quoteTweetId = A.id`
- Frontend receives `quoteTweetId: "A"` but fetching Tweet A returns NOT_FOUND or `deleted: true`
- No spec documents how to handle broken quote chains

**G-QUOTE5: No cascade delete.**
If the original tweet is deleted (`deleted: true`):
- Quote tweets referencing it remain (`quoteTweetId` is not nulled)
- Future quote attempts are blocked (line 342-347 check)
- Existing quote tweets show a "quoted tweet unavailable" state (frontend responsibility)

**G-QUOTE6: Quote tweets vs replies distinction.**
Both use nullable foreign keys (`quoteTweetId`, `parentId`) but serve different purposes:
- **Replies** (`parentId`): Threaded conversation, increment original tweet's `replyCount`
- **Quote tweets** (`quoteTweetId`): Standalone commentary, do NOT increment any count

A tweet can have BOTH `parentId` and `quoteTweetId` (replying to one tweet while quoting another). Schema allows this but no UI/procedure enforces or documents it.

**G-QUOTE7: Notification semantics.**
`QUOTE_TWEET` notifications are sent but no spec documents:
- Whether notifications are sent for quotes of quotes (nested chains)
- Whether deleted quotes remove the notification (currently: no)
- Rate limiting or spam protection for quote notifications

**G-QUOTE8: Search and discovery.**
Quote tweets appear in:
- ✓ Author's tweet timeline (`user.ts` — `authorId` filter)
- ✓ Full-text search (`search.ts` — matches content)
- ✗ NOT in a "quotes of this tweet" timeline (no procedure exists)

To build a "View quotes" feature, you would need a new procedure:
```typescript
getQuotesOfTweet({ tweetId, cursor, limit })
```
Currently unimplemented.
