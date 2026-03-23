# User Select Patterns (publicUserSelect vs selfUserSelect)

## What

Two predefined Prisma `select` objects enforce separation between public-facing user data and self-scoped user data. `publicUserSelect` exposes safe fields for any user profile, while `selfUserSelect` adds `email` for the authenticated user viewing their own profile. This prevents accidental leakage of email addresses and other sensitive fields.

## Where

Defined in `src/server/db.ts:88-112`:

```typescript
export const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  bannerUrl: true,
  createdAt: true,
  followerCount: true,
  followingCount: true,
  tweetCount: true,
} as const;

export const selfUserSelect = {
  ...publicUserSelect,
  email: true,
} as const;
```

Used extensively across all tRPC routers and services:

- **Public-facing endpoints** (use `publicUserSelect`):
  - `src/server/trpc/routers/user.ts:37-60` — `getByUsername` (public profiles)
  - `src/server/trpc/routers/social.ts:83-127` — `getFollowers`, `getFollowing` (user lists)
  - `src/server/trpc/routers/social.ts:317-359` — `getSuggestions` (who-to-follow)
  - `src/server/trpc/routers/search.ts:171-186` — `users` search results
  - `src/server/trpc/routers/engagement.ts:434-464` — `getLikers` (engagement attribution)
  - `src/server/trpc/routers/notification.ts:27-103` — `list` (actor payloads in notifications)
  - `src/server/trpc/routers/feed.ts:99-107` — `home`, `user` timelines (tweet authors)
  - `src/server/trpc/routers/tweet.ts:387-442` — `getReplies` (reply authors)

- **Self-scoped endpoints** (use `selfUserSelect`):
  - `src/server/trpc/routers/user.ts:69-94` — `updateProfile` (returns own profile with email)

- **Service layer**:
  - `src/server/services/feed.ts:265-320` — Feed assembly (tweet authors via `publicUserSelect`)

## How It Works

**1. Public User Data**

`publicUserSelect` returns all fields safe for public display. Used when fetching:
- Other users' profiles (user pages, search results)
- User lists (followers, following, likers, who-to-follow)
- Tweet author metadata in feeds and threads
- Notification actor data (who liked, retweeted, followed, or replied)

Example from `src/server/trpc/routers/user.ts:29-39`:
```typescript
// Public profile — any user can view any other user
const user = await prisma.user.findUnique({
  where: { username },
  select: publicUserSelect,  // ← No email exposed
});

if (!user) {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "User not found",
  });
}
```

**2. Self User Data**

`selfUserSelect` extends `publicUserSelect` with `email`. Used when returning the authenticated user's own data after mutations:

Example from `src/server/trpc/routers/user.ts:82-91`:
```typescript
// Self-scoped — user updating own profile
const updatedUser = await prisma.user.update({
  where: { id: userId },
  data: {
    ...(displayName !== undefined && { displayName }),
    ...(bio !== undefined && { bio }),
    ...(avatarUrl !== undefined && { avatarUrl }),
    ...(bannerUrl !== undefined && { bannerUrl }),
  },
  select: selfUserSelect,  // ← Email included
});
return updatedUser;
```

**3. Nested Author Fields**

Tweet queries nest `author` with `publicUserSelect` to prevent default column inclusion:

Example from `src/server/trpc/routers/feed.ts:99-107`:
```typescript
const tweets = await db.tweet.findMany({
  where: { deleted: false, authorId: { in: authorIds } },
  select: {
    id: true,
    content: true,
    // ... other tweet fields
    author: { select: publicUserSelect },  // ← Explicit select required
  },
});
```

Without the explicit `select`, Prisma would return **all** User columns by default, including `hashedPassword`, `sessionVersion`, and `email`.

## Invariants

**I1: publicUserSelect MUST NOT include sensitive fields**

`publicUserSelect` never includes:
- `email` (PII, only visible to self)
- `hashedPassword` (secret, never exposed in any API response)
- `sessionVersion` (internal auth state, never exposed)
- `passwordResetToken`, `passwordResetExpiry`, `passwordResetUsed` (internal auth state)

Violation would leak PII or auth state to arbitrary users.

**I2: selfUserSelect ONLY adds email**

`selfUserSelect` extends `publicUserSelect` with **only** `email`. It MUST NOT include `hashedPassword` or `sessionVersion`.

Enforcement: TypeScript const assertion ensures both selects are frozen. Any modification requires explicit code change and review.

**I3: Nested User includes MUST use explicit select**

Any Prisma query with `include: { author: true }` or `include: { user: true }` without a nested `select` is a **security bug**. Prisma defaults to returning all columns.

Correct pattern:
```typescript
select: {
  author: { select: publicUserSelect },
  // or
  user: { select: publicUserSelect },
}
```

Incorrect pattern (returns all User columns):
```typescript
include: { author: true }  // ❌ DANGEROUS
```

**I4: selfUserSelect only used in self-scoped protected procedures**

Only `updateProfile` uses `selfUserSelect` when returning the updated user profile. All other user-fetching procedures use `publicUserSelect`, even for authenticated users viewing other profiles.

## Gotchas

**G1: Default Prisma behavior is unsafe**

Prisma's default `include` returns **all** columns. Without explicit `select`, you will leak `hashedPassword` and `email` to the client.

**G2: publicUserSelect in search results**

User search (`src/server/trpc/routers/search.ts:171-186`) uses `publicUserSelect` even though the searcher is authenticated. Email is **never** exposed in search results, followers lists, or likers lists — even if the authenticated user is searching for themselves.

The user's email is only returned when they update their profile via `user.updateProfile`.

**G3: Notification actor payloads**

Notifications include actor data (who performed the action). Actors use `publicUserSelect` (`src/server/trpc/routers/notification.ts:39-41`):

```typescript
actor: { select: publicUserSelect }
```

This prevents email leakage in notification feeds.

**G4: Type assertions with const selects**

Both selects are defined with `as const`, making them readonly. TypeScript enforces that you cannot accidentally mutate them. To create a variant, spread and redefine:

```typescript
// ✅ Correct
const adminUserSelect = {
  ...publicUserSelect,
  createdAt: true,
  sessionVersion: true,  // admin-only field
} as const;

// ❌ WRONG (mutation)
publicUserSelect.email = true;  // TypeScript compile error
```

**G5: Tests validate enforcement**

`tests/integration/security.test.ts` verifies that `getByUsername` never returns `email` or `hashedPassword`, even when viewing your own profile via username lookup. Only `getCurrent` returns `email`.

**G6: Migration safety**

If new PII fields are added to the User model (e.g., `phoneNumber`, `dateOfBirth`), they are **not** automatically included in `publicUserSelect`. This fail-safe prevents accidental leakage — new sensitive fields require explicit opt-in to either select object.
