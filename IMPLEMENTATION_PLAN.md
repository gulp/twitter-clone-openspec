# Twitter Clone — Clean-Room Implementation Plan

> Generated from openspec/ artifacts. This is the authoritative build plan.
> All existing code is deleted. Every file listed below must be created from scratch.

---

## Table of Contents

1. [Architecture Decisions & Gap Resolution](#1-architecture-decisions--gap-resolution)
2. [Directory Structure](#2-directory-structure)
3. [Prisma Schema (Reference Artifact)](#3-prisma-schema-reference-artifact)
4. [Redis Key Patterns](#4-redis-key-patterns)
5. [tRPC Router Structure](#5-trpc-router-structure)
6. [Phase Plan (Reordered for Parallelism)](#6-phase-plan)
7. [Risks & Mitigations](#7-risks--mitigations)

---

## 1. Architecture Decisions & Gap Resolution

The specs leave several things unspecified. These are the concrete decisions for each gap.

### 1.1 IDs: CUID2
All primary keys use `cuid2` via Prisma's `@default(cuid())`. CUIDs are URL-safe, sortable-enough, and avoid UUID display ugliness. Tweet IDs in URLs look like `/tweet/clx9abc123` rather than `/tweet/550e8400-e29b-...`.

### 1.2 Cursor-Based Pagination Pattern
Every paginated endpoint uses the same shape:
```typescript
type PaginatedInput = { cursor?: string; limit?: number }  // limit defaults to 20
type PaginatedOutput<T> = { items: T[]; nextCursor: string | null }
```
The cursor is always the `id` of the last item (CUID is roughly time-ordered). For feeds where ordering is by `createdAt`, the cursor is a compound `createdAt_id` string (ISO timestamp + underscore + id) to handle ties.

### 1.3 Engagement Counts: Denormalized Columns
The spec mentions "increment/decrement counts" for likes, retweets, replies, followers, following. We store these as denormalized integer columns on Tweet (`likeCount`, `retweetCount`, `replyCount`) and User (`followerCount`, `followingCount`, `tweetCount`). Updates happen in the same Prisma transaction as the relationship creation/deletion.

### 1.4 Password Reset Token Storage
The spec says "1-hour one-time link." We store tokens in a `PasswordResetToken` model with `token` (hashed with SHA-256, the raw token goes in the email), `userId`, `expiresAt`. The token is a `crypto.randomBytes(32).toString('hex')`.

### 1.5 Email Sending
Specs mention sending password reset emails but do not specify a provider. Decision: use `nodemailer` with a configurable SMTP transport. For local dev, use Ethereal (fake SMTP). The email service is a thin abstraction (`src/server/services/email.ts`) so it can be swapped for SendGrid/SES later.

### 1.6 OAuth Username Generation
When a user signs in via OAuth for the first time, we need to generate a username (the spec says accounts are auto-created). Decision: derive from the OAuth display name — lowercase, strip non-alphanumeric, truncate to 15 chars, append random 4-digit suffix if collision.

**v1 decision:** Auto-generate username, no onboarding step. Users can see their profile and change displayName/bio but username is immutable per spec.

### 1.7 Rate Limiting
Not mentioned in specs but needed. Decision: Redis-based sliding window rate limiter as tRPC middleware. Rates:
- Auth endpoints (register, login, password reset): 5 requests/minute per IP
- Tweet creation: 30 tweets/hour per user
- General API: 100 requests/minute per user

### 1.8 SSE Implementation
The spec says "single multiplexed SSE connection." Decision: a Next.js Route Handler at `GET /api/sse` that checks auth, holds the connection open, and writes `text/event-stream` responses. Server-side publishing uses an in-process `EventEmitter` (single-server assumption for v1). Event types: `new-tweet`, `notification`. For multi-server, swap EventEmitter for Redis Pub/Sub — the abstraction (`src/server/services/sse-publisher.ts`) supports both.

### 1.9 Feed Assembly Strategy
The design doc confirms fan-out-on-read. Home timeline query:
1. Get list of followed user IDs
2. Query tweets WHERE authorId IN (followedIds) OR (retweets by followed users), ordered by createdAt DESC, limit 21 (fetch one extra to determine if there is a next page)
3. Deduplicate: if a tweet appears as both original and retweet, keep whichever appeared first chronologically
4. Cache the result page in Redis with TTL 60s

### 1.10 NextAuth Session Strategy
Use NextAuth with `jwt` strategy for the session token (stored in HTTP-only cookie), but maintain a server-side session record in Redis keyed by the JWT's `jti` claim. This allows session invalidation (logout, password reset) while keeping NextAuth happy. The JWT contains only `{ sub: userId, jti: sessionId }`.

### 1.11 Full-Text Search Setup
PostgreSQL `tsvector` column on Tweet with a GIN index. Use a generated column `searchVector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`. This avoids triggers and keeps the schema self-contained. The search query uses `plainto_tsquery` with `ts_rank` for ordering.

### 1.12 No Edit in v1
The design.md is authoritative. No tweet edit functionality.

---

## 2. Directory Structure

```
twitter-clone/
├── .env.example
├── .env.local                    # git-ignored
├── .gitignore
├── docker-compose.yml
├── next.config.ts
├── package.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/               # auto-generated
├── public/
│   └── placeholder-avatar.png
├── src/
│   ├── app/                      # Next.js App Router pages
│   │   ├── layout.tsx            # root layout (providers, fonts)
│   │   ├── page.tsx              # redirect to /home or /login
│   │   ├── globals.css           # Tailwind imports
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── reset-password/
│   │   │       ├── page.tsx      # request reset
│   │   │       └── [token]/page.tsx  # complete reset
│   │   ├── (main)/               # layout with sidebar nav
│   │   │   ├── layout.tsx        # app shell: left nav, right sidebar
│   │   │   ├── home/page.tsx     # home feed
│   │   │   ├── search/page.tsx   # search page with tabs
│   │   │   ├── notifications/page.tsx
│   │   │   ├── [username]/
│   │   │   │   ├── page.tsx      # user profile
│   │   │   │   ├── followers/page.tsx
│   │   │   │   ├── following/page.tsx
│   │   │   │   └── status/
│   │   │   │       └── [tweetId]/page.tsx  # tweet detail
│   │   │   └── compose/
│   │   │       └── tweet/page.tsx  # mobile compose
│   │   └── api/
│   │       ├── trpc/[trpc]/route.ts  # tRPC handler
│   │       ├── auth/[...nextauth]/route.ts  # NextAuth
│   │       └── sse/route.ts       # SSE endpoint
│   ├── components/
│   │   ├── ui/                    # generic UI primitives
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── modal.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── skeleton.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── dropdown.tsx
│   │   │   └── infinite-scroll.tsx
│   │   ├── auth/
│   │   │   ├── login-form.tsx
│   │   │   ├── register-form.tsx
│   │   │   └── oauth-buttons.tsx
│   │   ├── tweet/
│   │   │   ├── tweet-card.tsx
│   │   │   ├── tweet-composer.tsx
│   │   │   ├── tweet-thread.tsx
│   │   │   ├── quote-tweet-embed.tsx
│   │   │   └── engagement-buttons.tsx
│   │   ├── media/
│   │   │   ├── image-grid.tsx
│   │   │   ├── image-lightbox.tsx
│   │   │   └── image-upload.tsx
│   │   ├── profile/
│   │   │   ├── profile-header.tsx
│   │   │   ├── profile-tabs.tsx
│   │   │   └── edit-profile-modal.tsx
│   │   ├── feed/
│   │   │   ├── feed-list.tsx
│   │   │   ├── new-tweets-indicator.tsx
│   │   │   └── empty-feed.tsx
│   │   ├── social/
│   │   │   ├── follow-button.tsx
│   │   │   ├── user-list.tsx
│   │   │   └── who-to-follow.tsx
│   │   ├── notification/
│   │   │   ├── notification-card.tsx
│   │   │   └── notification-bell.tsx
│   │   ├── search/
│   │   │   ├── search-input.tsx
│   │   │   ├── search-results.tsx
│   │   │   └── search-user-card.tsx
│   │   └── layout/
│   │       ├── sidebar-nav.tsx
│   │       ├── mobile-bottom-nav.tsx
│   │       ├── right-sidebar.tsx
│   │       └── loading-skeletons.tsx
│   ├── server/
│   │   ├── db.ts                 # Prisma client singleton
│   │   ├── redis.ts              # Redis client singleton
│   │   ├── s3.ts                 # S3/MinIO client
│   │   ├── auth.ts               # NextAuth config
│   │   ├── trpc/
│   │   │   ├── index.ts          # tRPC init, context, base procedures
│   │   │   ├── router.ts         # root router (merges all sub-routers)
│   │   │   └── routers/
│   │   │       ├── auth.ts       # register, login, reset-password
│   │   │       ├── user.ts       # profile queries/mutations
│   │   │       ├── tweet.ts      # create, delete, get, replies
│   │   │       ├── feed.ts       # home timeline, user timeline
│   │   │       ├── social.ts     # follow, unfollow, lists, suggestions
│   │   │       ├── engagement.ts # like, retweet, quote-tweet, likers
│   │   │       ├── notification.ts # list, mark-read, unread-count
│   │   │       ├── search.ts     # tweet search, user search
│   │   │       └── media.ts      # pre-signed URL generation
│   │   └── services/
│   │       ├── notification.ts   # notification creation + self-suppression
│   │       ├── mention.ts        # @mention parsing
│   │       ├── feed.ts           # feed assembly + dedup logic
│   │       ├── email.ts          # email sending abstraction
│   │       ├── sse-publisher.ts  # SSE event bus
│   │       └── rate-limiter.ts   # Redis rate limiter
│   ├── lib/
│   │   ├── trpc.ts              # tRPC client (React hooks)
│   │   ├── utils.ts             # general utilities (cn, formatDate, etc.)
│   │   ├── validators.ts        # shared Zod schemas
│   │   └── constants.ts         # magic numbers, limits
│   └── hooks/
│       ├── use-sse.ts            # SSE client hook with auto-reconnect
│       ├── use-debounce.ts       # 300ms debounce for search
│       └── use-infinite-scroll.ts # intersection observer hook
├── openspec/                     # preserved specs (read-only)
│   └── ...
└── tests/
    ├── unit/
    │   ├── mention-parser.test.ts
    │   ├── feed-dedup.test.ts
    │   └── validators.test.ts
    ├── integration/
    │   ├── auth.test.ts
    │   ├── tweet.test.ts
    │   ├── social.test.ts
    │   ├── engagement.test.ts
    │   └── helpers.ts
    └── e2e/
        ├── playwright.config.ts
        └── specs/
            ├── auth.spec.ts
            └── tweet.spec.ts
```

---

## 3. Prisma Schema (Reference Artifact)

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearch"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id             String    @id @default(cuid())
  email          String    @unique
  username       String    @unique
  displayName    String
  bio            String    @default("")
  avatarUrl      String    @default("")
  bannerUrl      String    @default("")
  hashedPassword String?   // null for OAuth-only users
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  // Counts (denormalized)
  followerCount  Int       @default(0)
  followingCount Int       @default(0)
  tweetCount     Int       @default(0)

  // Relations
  tweets         Tweet[]   @relation("AuthoredTweets")
  likes          Like[]
  retweets       Retweet[]
  followers      Follow[]  @relation("Following")  // users who follow this user
  following      Follow[]  @relation("Followers")   // users this user follows
  notifications  Notification[] @relation("Recipient")
  actedNotifications Notification[] @relation("Actor")
  accounts       Account[]
  sessions       Session[]
  passwordResetTokens PasswordResetToken[]
}

model Tweet {
  id            String    @id @default(cuid())
  content       String    @db.VarChar(280)
  authorId      String
  parentId      String?   // reply-to
  quoteTweetId  String?   // quote tweet
  mediaUrls     String[]  // array of S3 URLs
  deleted       Boolean   @default(false)
  createdAt     DateTime  @default(now())

  // Counts (denormalized)
  likeCount     Int       @default(0)
  retweetCount  Int       @default(0)
  replyCount    Int       @default(0)

  // Relations
  author        User      @relation("AuthoredTweets", fields: [authorId], references: [id])
  parent        Tweet?    @relation("Replies", fields: [parentId], references: [id])
  replies       Tweet[]   @relation("Replies")
  quotedTweet   Tweet?    @relation("QuoteTweets", fields: [quoteTweetId], references: [id])
  quotedBy      Tweet[]   @relation("QuoteTweets")
  likes         Like[]
  retweets      Retweet[]
  notifications Notification[]

  @@index([authorId, createdAt(sort: Desc)])
  @@index([parentId])
}

model Follow {
  followerId  String
  followingId String
  createdAt   DateTime @default(now())

  follower    User     @relation("Followers", fields: [followerId], references: [id])
  following   User     @relation("Following", fields: [followingId], references: [id])

  @@id([followerId, followingId])
  @@index([followerId])
  @@index([followingId])
}

model Like {
  userId    String
  tweetId   String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id])
  tweet     Tweet    @relation(fields: [tweetId], references: [id])

  @@id([userId, tweetId])
  @@index([tweetId])
}

model Retweet {
  userId    String
  tweetId   String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id])
  tweet     Tweet    @relation(fields: [tweetId], references: [id])

  @@id([userId, tweetId])
  @@index([tweetId])
  @@index([userId, createdAt(sort: Desc)])
}

model Notification {
  id          String           @id @default(cuid())
  recipientId String
  type        NotificationType
  actorId     String
  tweetId     String?
  read        Boolean          @default(false)
  createdAt   DateTime         @default(now())

  recipient   User             @relation("Recipient", fields: [recipientId], references: [id])
  actor       User             @relation("Actor", fields: [actorId], references: [id])
  tweet       Tweet?           @relation(fields: [tweetId], references: [id])

  @@index([recipientId, createdAt(sort: Desc)])
  @@index([recipientId, read])
}

enum NotificationType {
  LIKE
  RETWEET
  FOLLOW
  REPLY
  MENTION
}

model PasswordResetToken {
  id        String   @id @default(cuid())
  tokenHash String   @unique  // SHA-256 hash of the raw token
  userId    String
  expiresAt DateTime
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id])

  @@index([tokenHash])
}

// NextAuth models
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

**Post-migration raw SQL** (run via `prisma migrate` custom SQL):
```sql
-- Add full-text search generated column and GIN index
ALTER TABLE "Tweet" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS "Tweet_search_vector_idx" ON "Tweet" USING GIN ("search_vector");
```

---

## 4. Redis Key Patterns

| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `session:{sessionToken}` | String (JSON) | 30 days (sliding) | NextAuth session data |
| `feed:{userId}:page:{cursor}` | String (JSON) | 60s | Cached feed page |
| `feed:{userId}:invalidate` | String | 5s | Cache-bust flag on new follow/tweet |
| `sse:connections:{userId}` | Set | none | Track active SSE connection IDs |
| `rate:{endpoint}:{identifier}` | Sorted Set | 1-60 min | Sliding window rate limiter |
| `unread:{userId}` | String (integer) | none | Unread notification count |

---

## 5. tRPC Router Structure

```
appRouter
├── auth
│   ├── register          (mutation, public)
│   ├── login             (mutation, public)
│   ├── requestReset      (mutation, public)
│   └── completeReset     (mutation, public)
├── user
│   ├── getByUsername      (query, public)
│   ├── updateProfile      (mutation, protected)
│   └── getUploadUrl       (mutation, protected)  // avatar/banner upload URL
├── tweet
│   ├── create             (mutation, protected)
│   ├── delete             (mutation, protected)
│   ├── getById            (query, public)
│   ├── getReplies         (query, public)
│   └── getUserTweets      (query, public)
├── feed
│   ├── home               (query, protected)
│   └── userTimeline       (query, public)
├── social
│   ├── follow             (mutation, protected)
│   ├── unfollow           (mutation, protected)
│   ├── getFollowers       (query, public)
│   ├── getFollowing       (query, public)
│   └── getSuggestions     (query, protected)
├── engagement
│   ├── like               (mutation, protected)
│   ├── unlike             (mutation, protected)
│   ├── retweet            (mutation, protected)
│   ├── undoRetweet        (mutation, protected)
│   ├── quoteTweet         (mutation, protected)
│   └── getLikers          (query, public)
├── notification
│   ├── list               (query, protected)
│   ├── unreadCount        (query, protected)
│   ├── markRead           (mutation, protected)
│   └── markAllRead        (mutation, protected)
├── search
│   ├── tweets             (query, public)
│   └── users              (query, public)
└── media
    └── getUploadUrl       (mutation, protected)
```

---

## 6. Phase Plan

### Phase A: Foundation (Tasks 1.1-1.7, 2.1-2.10)
**Parallelism:** None — everything else depends on this.

#### Files to Create

| File | Purpose |
|---|---|
| `package.json` | Dependencies: next@14, react@18, @trpc/server, @trpc/client, @trpc/react-query, @tanstack/react-query, @prisma/client, prisma, next-auth, @next-auth/prisma-adapter, ioredis, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, bcryptjs, zod, tailwindcss, postcss, autoprefixer, nodemailer, clsx, tailwind-merge, date-fns |
| `tsconfig.json` | Strict mode, paths aliases (`@/*` -> `src/*`) |
| `next.config.ts` | Image domains (S3/MinIO) |
| `tailwind.config.ts` | Content paths, custom theme (Twitter blue #1DA1F2) |
| `postcss.config.js` | Tailwind + autoprefixer |
| `.env.example` | All env vars documented |
| `.gitignore` | node_modules, .env.local, .next, prisma/migrations/*.sql |
| `docker-compose.yml` | PostgreSQL (5432), Redis (6379), MinIO (9000/9001) |
| `prisma/schema.prisma` | Full schema as defined in Section 3 |
| `src/server/db.ts` | Prisma client singleton with global dev cache |
| `src/server/redis.ts` | ioredis client singleton |
| `src/server/s3.ts` | S3Client configured for MinIO in dev, AWS in prod |
| `src/server/auth.ts` | NextAuth config: providers, adapter, callbacks, session strategy |
| `src/server/trpc/index.ts` | createTRPCContext, initTRPC, publicProcedure, protectedProcedure |
| `src/server/trpc/router.ts` | Root appRouter (empty routers initially) |
| `src/app/api/trpc/[trpc]/route.ts` | tRPC HTTP handler |
| `src/app/api/auth/[...nextauth]/route.ts` | NextAuth route handler |
| `src/lib/trpc.ts` | tRPC React client setup with React Query |
| `src/app/layout.tsx` | Root layout with TRPCProvider, SessionProvider |
| `src/app/globals.css` | Tailwind directives |
| `src/app/page.tsx` | Root redirect |
| `src/lib/constants.ts` | MAX_TWEET_LENGTH=280, MAX_BIO_LENGTH=160, PAGE_SIZE=20, etc. |
| `src/lib/validators.ts` | Shared Zod schemas for all input validation |

**Done criteria:**
- `docker compose up` starts PostgreSQL, Redis, MinIO
- `npx prisma migrate dev` creates all tables
- `npm run dev` serves Next.js at localhost:3000
- tRPC health check endpoint responds
- NextAuth `/api/auth/providers` returns configured providers

---

### Phase B: Authentication (Tasks 3.1-3.10)
**Depends on:** Phase A
**Parallelism:** Backend (B1) and Frontend (B2) can partially overlap.

#### B1: Auth Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/auth.ts` | register, requestReset, completeReset mutations |
| `src/server/auth.ts` (update) | CredentialsProvider with bcrypt, Google + GitHub OAuth, callbacks for auto-account creation, session handling |
| `src/server/services/email.ts` | sendPasswordResetEmail using nodemailer |
| `src/server/services/rate-limiter.ts` | Redis sliding-window rate limiter middleware |
| `src/lib/validators.ts` (update) | registerSchema, loginSchema, resetSchema Zod validators |

**Key implementation details:**
- `register` mutation: validate input, check uniqueness, hash password with bcrypt (cost 12), create user, return session
- CredentialsProvider `authorize`: find user by email, compare bcrypt hash, return user or null
- OAuth `signIn` callback: if no user exists for the OAuth email, create one with auto-generated username
- `protectedProcedure` in tRPC: check `ctx.session`, throw `UNAUTHORIZED` if missing

#### B2: Auth Frontend

| File | Purpose |
|---|---|
| `src/app/(auth)/login/page.tsx` | Login form + OAuth buttons |
| `src/app/(auth)/register/page.tsx` | Registration form |
| `src/app/(auth)/reset-password/page.tsx` | Request reset form |
| `src/app/(auth)/reset-password/[token]/page.tsx` | Complete reset form |
| `src/components/auth/login-form.tsx` | Email/password form with validation |
| `src/components/auth/register-form.tsx` | Registration form with all validations |
| `src/components/auth/oauth-buttons.tsx` | Google + GitHub sign-in buttons |

**Done criteria:**
- User can register with email/password, receive session cookie, see authenticated state
- Duplicate email/username shows correct error messages
- Google and GitHub OAuth create accounts and log in
- Logout destroys session
- Password reset email is sent (visible in Ethereal), link works, all sessions invalidated
- Unauthenticated access to protected tRPC routes returns 401

---

### Phase C: Core Data Layer (Tasks 5.1-5.5, 6.1, 7.1-7.5, 8.1-8.4)
**Depends on:** Phase B (auth middleware)
**Parallelism:** C1 (Tweets), C2 (Media), C3 (Social Graph), C4 (Engagement) can all run in parallel. C5 (Notification Service) should be built first or concurrently.

#### C1: Tweet Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/tweet.ts` | create, delete, getById, getReplies, getUserTweets |
| `src/server/services/mention.ts` | parseMentions(text): extracts @usernames, returns user IDs |

**Key details:**
- `create`: validate content length, require text or media, parse mentions, create tweet in transaction (increment author's tweetCount), fire mention notifications
- `delete`: verify authorId === session.userId, set deleted=true, decrement tweetCount
- `getById`: include author, counts; if deleted return null/404; if authenticated, include `hasLiked` and `hasRetweeted` via subqueries
- `getReplies`: WHERE parentId = tweetId AND deleted = false, paginated

#### C2: Media Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/media.ts` | getUploadUrl mutation |

**Key details:**
- Input: `{ filename: string, contentType: string, purpose: 'tweet' | 'avatar' | 'banner' }`
- Validate contentType against allowed MIME types
- Generate S3 key: `{purpose}/{userId}/{cuid()}.{ext}`
- Return `{ uploadUrl: presignedPutUrl, publicUrl: finalUrl }`
- Pre-signed URL expires in 10 minutes

#### C3: Social Graph Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/social.ts` | follow, unfollow, getFollowers, getFollowing, getSuggestions |

**Key details:**
- `follow`: check self-follow, upsert Follow record, increment counts in transaction, fire follow notification
- `unfollow`: delete Follow record if exists, decrement counts in transaction
- `getSuggestions`: raw SQL query — find users followed by people the current user follows, exclude already-followed, group by suggested user, order by count of mutual connections, limit 10

#### C4: Engagement Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/engagement.ts` | like, unlike, retweet, undoRetweet, quoteTweet, getLikers |

**Key details:**
- `like`: upsert Like, conditionally increment likeCount (only if new), fire like notification
- `unlike`: delete Like if exists, conditionally decrement
- `retweet`: check self-retweet, upsert Retweet, conditionally increment, fire notification
- `quoteTweet`: create Tweet with quoteTweetId, fire notification to quoted author
- `getLikers`: join Like with User, paginated

#### C5: Notification Service

| File | Purpose |
|---|---|
| `src/server/services/notification.ts` | createNotification function with self-suppression check |
| `src/server/trpc/routers/notification.ts` | list, unreadCount, markRead, markAllRead |

**Key details:**
- `createNotification({ recipientId, actorId, type, tweetId? })`: if recipientId === actorId, return early (self-suppression). Otherwise create record, increment Redis unread count, publish SSE event.
- `list`: WHERE recipientId = userId, include actor (username, displayName, avatarUrl) and tweet (content preview), paginated
- `markAllRead`: UPDATE Notification SET read=true WHERE recipientId=userId AND read=false

**Done criteria for Phase C:**
- All tRPC endpoints respond correctly
- Tweet CRUD works with proper validation errors
- Follow/unfollow correctly updates counts
- Like/retweet idempotency works
- Self-retweet blocked, self-follow blocked
- Notifications created for all event types
- Self-notifications suppressed
- Mention parser extracts @usernames correctly

---

### Phase D: Feed Assembly + Search (Tasks 9.1-9.4, 12.1-12.2)
**Depends on:** Phase C (tweets, social graph, engagement must exist)
**Parallelism:** D1 (Feed) and D2 (Search) can run in parallel.

#### D1: Feed Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/feed.ts` | home, userTimeline queries |
| `src/server/services/feed.ts` | assembleFeed, deduplicateFeed, cacheGet/cacheSet |

**Home timeline algorithm:**
```
1. followedIds = SELECT followingId FROM Follow WHERE followerId = currentUserId
2. tweets = SELECT t.*, u.username, u.displayName, u.avatarUrl
     FROM Tweet t JOIN User u ON t.authorId = u.id
     WHERE (t.authorId IN (followedIds) AND t.deleted = false)
     ORDER BY t.createdAt DESC
     LIMIT 21
3. retweets = SELECT rt.*, t.*, u.* FROM Retweet rt
     JOIN Tweet t ON rt.tweetId = t.id
     JOIN User u ON t.authorId = u.id
     WHERE rt.userId IN (followedIds) AND t.deleted = false
     ORDER BY rt.createdAt DESC
     LIMIT 21
4. Merge + deduplicate + sort by effective timestamp
5. If authenticated, batch-check hasLiked/hasRetweeted for all tweet IDs
6. Cache result in Redis
```

#### D2: Search Backend

| File | Purpose |
|---|---|
| `src/server/trpc/routers/search.ts` | tweets, users queries |

**Key details:**
- Tweet search: `SELECT *, ts_rank(search_vector, query) AS rank FROM Tweet, plainto_tsquery('english', $1) query WHERE search_vector @@ query AND deleted = false ORDER BY rank DESC LIMIT 21`
- User search: `WHERE username ILIKE '%{q}%' OR displayName ILIKE '%{q}%' ORDER BY followerCount DESC LIMIT 21`

**Done criteria:**
- Home feed returns tweets from followed users only
- Feed deduplication works (same tweet via author + retweeter shows once)
- Cursor pagination works correctly
- Tweet search returns relevant results with stemming
- User search returns by substring match ordered by popularity

---

### Phase E: Real-Time SSE (Tasks 10.1-10.6)
**Depends on:** Phase C (notification service), Phase D (feed)
**Parallelism:** Can run in parallel with Phase F (Frontend).

| File | Purpose |
|---|---|
| `src/app/api/sse/route.ts` | GET handler: auth check, hold connection, stream events |
| `src/server/services/sse-publisher.ts` | EventEmitter-based pub/sub: publish(userId, event), subscribe(userId, callback) |
| `src/hooks/use-sse.ts` | Client hook: connect to /api/sse, parse events, auto-reconnect with exponential backoff |

**Key details:**
- SSE route: `export async function GET(req) { ... }` using `ReadableStream` and `TransformStream`
- Event format: `event: {type}\ndata: {json}\n\n`
- Event types: `new-tweet` (payload: `{ tweetId, authorUsername }`), `notification` (payload: `{ notification }`)
- Publisher: when a tweet is created, find all follower IDs, publish `new-tweet` to each. When a notification is created, publish `notification` to recipient.
- Client hook returns `{ newTweetCount, latestNotification, resetTweetCount }`.

**Done criteria:**
- SSE connection established on page load for authenticated users
- New tweet by followed user triggers `new-tweet` event on client
- New notification triggers `notification` event on client
- Connection auto-reconnects after drop

---

### Phase F: Frontend — Core UI (Tasks 5.6-5.8, 4.5-4.6, 9.5-9.6, 13.1-13.4)
**Depends on:** Phase B (auth UI), Phase C (all backend APIs), Phase D (feed/search APIs)
**Parallelism:** All sub-phases (F1-F6) can run in parallel.

#### F1: Layout Shell

| File | Purpose |
|---|---|
| `src/app/(main)/layout.tsx` | Three-column layout: left nav, center content, right sidebar |
| `src/components/layout/sidebar-nav.tsx` | Home, Search, Notifications, Profile links; compose button |
| `src/components/layout/mobile-bottom-nav.tsx` | Bottom tab bar for mobile |
| `src/components/layout/right-sidebar.tsx` | Search bar, trending (placeholder), who-to-follow |
| `src/components/layout/loading-skeletons.tsx` | Skeleton components for tweets, profiles, lists |
| `src/components/ui/*.tsx` | All UI primitives (button, input, modal, avatar, skeleton, tabs, dropdown, infinite-scroll) |

#### F2: Tweet Components

| File | Purpose |
|---|---|
| `src/components/tweet/tweet-card.tsx` | Full tweet card: avatar, author, content, media grid, engagement bar, timestamp |
| `src/components/tweet/tweet-composer.tsx` | Textarea with char counter, media upload button, submit |
| `src/components/tweet/tweet-thread.tsx` | Threaded reply view with connecting lines |
| `src/components/tweet/quote-tweet-embed.tsx` | Embedded quoted tweet card |
| `src/components/tweet/engagement-buttons.tsx` | Like (heart), retweet, reply, share buttons with counts |
| `src/components/media/image-grid.tsx` | 1/2/3/4 image responsive grid |
| `src/components/media/image-lightbox.tsx` | Full-screen image viewer |
| `src/components/media/image-upload.tsx` | File picker, preview, upload progress |

#### F3: Feed Pages

| File | Purpose |
|---|---|
| `src/app/(main)/home/page.tsx` | Home feed with composer at top, infinite scroll |
| `src/components/feed/feed-list.tsx` | Renders list of tweet cards with infinite scroll |
| `src/components/feed/new-tweets-indicator.tsx` | "N new tweets" banner using SSE hook |
| `src/components/feed/empty-feed.tsx` | Empty state with follow suggestions |
| `src/hooks/use-infinite-scroll.ts` | IntersectionObserver hook for pagination trigger |

#### F4: Profile Pages

| File | Purpose |
|---|---|
| `src/app/(main)/[username]/page.tsx` | Profile page: header + tabbed timelines |
| `src/app/(main)/[username]/followers/page.tsx` | Followers list |
| `src/app/(main)/[username]/following/page.tsx` | Following list |
| `src/components/profile/profile-header.tsx` | Banner, avatar, name, bio, stats, follow/edit button |
| `src/components/profile/profile-tabs.tsx` | Tweets / Replies / Likes tabs |
| `src/components/profile/edit-profile-modal.tsx` | Modal form for displayName, bio, avatar, banner |

#### F5: Social Components

| File | Purpose |
|---|---|
| `src/components/social/follow-button.tsx` | Follow/Following toggle with optimistic update |
| `src/components/social/user-list.tsx` | Reusable user list for followers/following/likers |
| `src/components/social/who-to-follow.tsx` | Suggestion cards with follow buttons |

#### F6: Tweet Detail Page

| File | Purpose |
|---|---|
| `src/app/(main)/[username]/status/[tweetId]/page.tsx` | Single tweet view with reply thread below |

**Done criteria:**
- App shell renders with responsive layout (3-col desktop, single-col mobile)
- Tweet composer creates tweets with character counter turning red at limit
- Tweet cards display correctly with all engagement buttons
- Home feed shows tweets from followed users with infinite scroll
- "N new tweets" indicator appears for new SSE events
- Profile pages show header, stats, and tabbed timelines
- Edit profile modal updates displayName and bio
- Follow/unfollow buttons work with optimistic UI
- Image grid renders correctly for 1-4 images
- Image lightbox opens on click

---

### Phase G: Frontend — Notifications, Search, Media Polish (Tasks 11.5-11.6, 12.3-12.4, 6.2-6.4)
**Depends on:** Phase E (SSE), Phase F (base UI components)
**Parallelism:** G1, G2, G3 can run in parallel.

#### G1: Notifications UI

| File | Purpose |
|---|---|
| `src/app/(main)/notifications/page.tsx` | Notification list page |
| `src/components/notification/notification-card.tsx` | Individual notification (icon by type, actor info, tweet preview) |
| `src/components/notification/notification-bell.tsx` | Bell icon with unread count badge, uses SSE hook |

#### G2: Search UI

| File | Purpose |
|---|---|
| `src/app/(main)/search/page.tsx` | Search page with input, tabs (Tweets/People), results |
| `src/components/search/search-input.tsx` | Search input with debounce |
| `src/components/search/search-results.tsx` | Tab-switched result lists |
| `src/components/search/search-user-card.tsx` | User result card with follow button |
| `src/hooks/use-debounce.ts` | 300ms debounce hook |

#### G3: Media Upload Polish

Complete the upload flow in tweet composer and edit profile modal:
- File selection with drag-and-drop
- Client-side validation (format, size, count)
- Client-side resize for avatars (400x400) and banners (1500x500) using canvas
- Upload progress indicator
- Preview before tweet submission

**Done criteria:**
- Notification page shows all notification types with correct icons and text
- Bell icon shows unread count that updates in real-time via SSE
- Mark as read works (single and bulk)
- Search returns results with 300ms debounce
- Tab switching between Tweets and People works
- Media upload flow is end-to-end functional

---

### Phase H: Testing (Tasks 14.1-14.5)
**Depends on:** All previous phases
**Parallelism:** H1, H2, H3 can run in parallel.

#### H1: Unit Tests

| File | Purpose |
|---|---|
| `tests/unit/mention-parser.test.ts` | @mention extraction edge cases |
| `tests/unit/feed-dedup.test.ts` | Deduplication logic |
| `tests/unit/validators.test.ts` | Zod schema validation |
| `vitest.config.ts` | Vitest configuration |

#### H2: Integration Tests

| File | Purpose |
|---|---|
| `tests/integration/auth.test.ts` | Register, login, logout, password reset flows |
| `tests/integration/tweet.test.ts` | Create, delete, reply, mention flows |
| `tests/integration/social.test.ts` | Follow, unfollow, suggestions |
| `tests/integration/engagement.test.ts` | Like, retweet, quote tweet |
| `tests/integration/helpers.ts` | Test utilities: create test user, create test tweet, etc. |

#### H3: E2E Tests

| File | Purpose |
|---|---|
| `playwright.config.ts` | Playwright config targeting localhost:3000 |
| `tests/e2e/specs/auth.spec.ts` | Registration and login E2E |
| `tests/e2e/specs/tweet.spec.ts` | Tweet creation and interaction E2E |

**Done criteria:**
- All unit tests pass
- Integration tests cover all critical flows
- E2E tests pass in headless Chromium
- No TypeScript errors (`tsc --noEmit` passes)

---

## 7. Risks & Mitigations

### Risk 1: NextAuth + Custom Credentials Complexity
NextAuth is designed primarily for OAuth and fights you on custom credential flows (no database sessions with credentials by default).
**Mitigation:** Use JWT strategy with a Redis-backed session invalidation layer. If this proves too complex, fall back to a fully custom auth implementation using bcrypt + iron-session, keeping the same API surface.

### Risk 2: Feed Query Performance
Fan-out-on-read means the home timeline query joins Follow + Tweet for every request. For users following 1000+ people, this is slow.
**Mitigation:** Redis caching with 60s TTL. Cache invalidation on new tweet/follow. For v1 with limited scale, this is acceptable. The architecture supports migration to fan-out-on-write (Redis sorted sets per user) later.

### Risk 3: SSE Connection Limits in Serverless
If deployed on Vercel, serverless functions have execution time limits. SSE requires long-lived connections.
**Mitigation:** Production deployment should use a Node.js server (Docker) rather than serverless. For Vercel deployment, degrade to polling as a fallback. The `use-sse.ts` hook should detect connection failures and fall back to polling the `notification.unreadCount` endpoint every 30 seconds.

### Risk 4: Prisma Full-Text Search Limitations
Prisma does not natively support PostgreSQL `tsvector` columns. The search query must use `$queryRaw`.
**Mitigation:** Encapsulate all FTS queries in `src/server/trpc/routers/search.ts` using `prisma.$queryRaw` with parameterized queries (no SQL injection). The generated column approach means no Prisma schema changes needed — it is invisible to Prisma.

### Risk 5: OAuth Username Generation Collisions
Auto-generating usernames from OAuth display names can create awkward or duplicate names.
**Mitigation:** Append random 4-digit suffix. If collision, retry with new suffix (max 3 retries). Usernames like `johndoe_4829` are acceptable for v1.

### Risk 6: Image Upload Reliability
Direct client-to-S3 upload can fail silently, leaving orphaned URLs in tweets.
**Mitigation:** The tweet creation mutation should verify that all mediaUrls are valid S3 URLs before saving. Pre-signed URLs expire in 10 minutes, so stale URLs cannot be reused.

---

## Appendix: Parallelism Summary

```
Phase A (Foundation)
    │
    v
Phase B (Auth)
    │
    v
Phase C1 (Tweets) ─────┐
Phase C2 (Media) ───────┤  All run in parallel
Phase C3 (Social) ──────┤
Phase C4 (Engagement) ──┤
Phase C5 (Notifications)┘
    │
    v
Phase D1 (Feed) ────────┐  Run in parallel
Phase D2 (Search) ──────┘
    │
    v
Phase E (SSE) ──────────┐
Phase F (Core UI) ──────┘  Run in parallel
    │
    v
Phase G (Notifications UI, Search UI, Media Polish)  — all sub-phases parallel
    │
    v
Phase H (Testing)  — all sub-phases parallel
```

**Maximum parallelism:** 5 concurrent workstreams in Phase C.

**Critical path:** A → B → C → D → F → G → H
