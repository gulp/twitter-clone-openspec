# Optimistic UI Mutation Pattern

## What

Optimistic UI updates provide instant feedback by updating the UI before the server responds. If the mutation fails, the UI reverts to its previous state. This pattern is implemented using tRPC React Query's mutation lifecycle hooks (`onMutate`, `onError`, `onSuccess`) combined with local React state.

## Where

Used in all interactive engagement components:

- `src/components/tweet/engagement-buttons.tsx:46-102` — Like/unlike, retweet/undo retweet
- `src/components/social/follow-button.tsx:37-70` — Follow/unfollow
- `src/components/notification/notification-card.tsx:87-93` — Mark notification as read (no optimistic update, just invalidation)
- `src/components/tweet/tweet-composer.tsx:38-61` — Create tweet (invalidation only, no optimistic state)

## How It Works

### 1. Local State Mirror

Components maintain local state that mirrors server state, initialized from props:

```typescript
// src/components/tweet/engagement-buttons.tsx:32-36
const [hasLiked, setHasLiked] = useState(initialHasLiked);
const [hasRetweeted, setHasRetweeted] = useState(initialHasRetweeted);
const [likeCount, setLikeCount] = useState(initialLikeCount);
const [retweetCount, setRetweetCount] = useState(initialRetweetCount);
```

### 2. Sync from Props with useEffect

When parent components re-fetch data (e.g., after query invalidation), local state syncs from props:

```typescript
// src/components/tweet/engagement-buttons.tsx:38-41
useEffect(() => { setHasLiked(initialHasLiked); }, [initialHasLiked]);
useEffect(() => { setHasRetweeted(initialHasRetweeted); }, [initialHasRetweeted]);
useEffect(() => { setLikeCount(initialLikeCount); }, [initialLikeCount]);
useEffect(() => { setRetweetCount(initialRetweetCount); }, [initialRetweetCount]);
```

### 3. Optimistic Update in onMutate

The mutation's `onMutate` callback immediately updates local state before the server responds:

```typescript
// src/components/tweet/engagement-buttons.tsx:46-57
const likeMutation = trpc.engagement.like.useMutation({
  onMutate: async () => {
    // Optimistic update
    setHasLiked(true);
    setLikeCount((prev) => prev + 1);
  },
  onError: () => {
    // Rollback on error
    setHasLiked(false);
    setLikeCount((prev) => prev - 1);
  },
});
```

### 4. Rollback on Error

If the mutation fails, `onError` reverts the optimistic changes:

```typescript
// src/components/tweet/engagement-buttons.tsx:52-56
onError: () => {
  // Rollback on error
  setHasLiked(false);
  setLikeCount((prev) => prev - 1);
},
```

### 5. Query Invalidation on Success

The `onSuccess` callback invalidates related queries to sync with server state. This triggers re-fetches that flow back through the useEffect sync mechanism:

```typescript
// src/components/tweet/engagement-buttons.tsx:83-86
onSuccess: () => {
  utils.feed.home.invalidate();
},
```

For follow/unfollow, multiple related queries are invalidated:

```typescript
// src/components/social/follow-button.tsx:46-51
onSuccess: () => {
  // Invalidate relevant queries
  utils.social.getFollowers.invalidate({ userId });
  utils.social.getFollowing.invalidate({ userId: session?.user?.id });
  utils.social.getSuggestions.invalidate();
},
```

### 6. Complete Lifecycle Example

Full follow mutation with all three phases:

```typescript
// src/components/social/follow-button.tsx:37-52
const followMutation = trpc.social.follow.useMutation({
  onMutate: async () => {
    // Optimistic update
    setIsFollowing(true);
  },
  onError: () => {
    // Rollback on error
    setIsFollowing(false);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    utils.social.getFollowers.invalidate({ userId });
    utils.social.getFollowing.invalidate({ userId: session?.user?.id });
    utils.social.getSuggestions.invalidate();
  },
});
```

## Invariants

1. **I1: Symmetric rollback** — Every optimistic update in `onMutate` has an exact inverse in `onError`. If `onMutate` increments a counter, `onError` decrements it by the same amount.

2. **I2: No server assumptions** — Optimistic state is always local. Never assume the server state has changed until `onSuccess` fires.

3. **I3: Props sync** — Local state always syncs from props via `useEffect`. This ensures state reconciles after query invalidation.

4. **I4: Invalidate, don't mutate cache** — Use `invalidate()` to trigger re-fetches, not `setData()` to mutate the cache directly. Cache mutation creates drift; invalidation guarantees consistency.

5. **I5: Count boundaries** — Counter rollbacks use `prev => prev - 1`, not `setCount(initialCount - 1)`. This prevents drift if multiple mutations are in flight.

## Gotchas

1. **Missing useEffect sync breaks reconciliation** — If you forget the `useEffect` hooks that sync from props, local state will diverge permanently after the first optimistic update. The component won't reflect server state even after successful invalidation.

2. **Invalidation without useEffect does nothing visually** — Calling `utils.query.invalidate()` in `onSuccess` triggers a re-fetch, but if the component doesn't sync local state from the new props, the UI won't update. Both parts are required.

3. **Racing mutations** — If a user clicks like/unlike rapidly, multiple mutations can be in flight. Using `prev => prev + 1` instead of `setCount(count + 1)` prevents drift from stale closures.

4. **Rollback doesn't undo side effects** — If `onMutate` calls other imperative code (e.g., analytics tracking), `onError` won't undo it. Keep `onMutate` pure (only setState).

5. **No optimistic updates for create operations** — TweetComposer doesn't use optimistic state because it creates new entities with unknown IDs. It only invalidates feeds in `onSuccess`. Optimistic UI works best for toggles and increments on existing entities.

6. **Don't invalidate in onMutate** — Invalidation triggers re-fetches that may race with the pending mutation. Always invalidate in `onSuccess`, not `onMutate`.
