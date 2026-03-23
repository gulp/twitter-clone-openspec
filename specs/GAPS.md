# Documentation Gaps

Sorted by priority. Checked items are addressed in existing specs.

## Critical (security, data integrity, auth)
- [x] Database CHECK constraints (§1.21) — covered in database-check-constraints.md
- [x] Silent configuration validation — covered in security-env-validation-edge-runtime.md
- [x] Password reset token race condition — covered in security-password-reset-tokens.md (UPDATED with SELECT FOR UPDATE implementation)
- [x] Password sanitization rules — covered in security-password-validation.md
- [x] PII redaction policy — covered in logging-structured-output-redaction.md (I-LOG2: no email/IP beyond userIds)
- [x] Timing-safe auth patterns — covered in security-timing-attacks.md
- [x] Fire-and-forget email service — covered in security-email-timing-safety.md
- [x] SIGTERM graceful shutdown — covered in sse-graceful-shutdown.md
- [x] CSRF origin validation — covered in security-csrf-origin.md
- [x] Session management — covered in security-session-management.md
- [x] CUID vs CUID2 mismatch — covered in database-id-generation-strategy.md (OAuth uses CUID correctly, media router uses CUID2 for S3 keys intentionally)
- [x] Raw SQL parameter injection safety — covered in security-sql-injection-prevention.md (Prisma.sql tagged templates + bare template literal parameterization, all 5 $queryRaw uses audited)

## High (core features, caching, pagination)
- [x] Security headers: HSTS in production — covered in security-csrf-and-headers.md (next.config.mjs:45-52 implements conditional HSTS for production)
- [x] Quote tweet design decisions — covered in engagement-quote-tweet-design.md
- [x] JSON parsing safety — covered in caching-json-parsing-safety.md
- [x] User select patterns (§1.13) — covered in security-user-select-patterns.md
- [ ] Batch engagement state checks (§1.16) — Promise.all + Set pattern implemented (feed.ts:119-131, search.ts:183-201) but no dedicated spec. Plan lines 358-365.
- [x] Full-text search implementation (§1.11) — covered in search-full-text-implementation.md
- [ ] Fire-and-forget async patterns — void (async () => {})() used inconsistently (email.ts:94-126, sse-publisher.ts:120-161, api/sse/route.ts). No policy doc defining when acceptable vs requires proper error handling.
- [ ] Silent .catch() error suppression policy — engagement-buttons.tsx:154, auth.ts:288 sessionDel, api/sse/route.ts:66-67 cleanup use silent suppression. No spec defining when acceptable vs requires logging.
- [ ] Promise.allSettled vs Promise.all consistency — SSE uses allSettled (sse-publisher.ts:203), feed uses all (feed.ts:312), tweets use all (tweet.ts:143-152). No unified policy.
- [ ] SSE partial success semantics — publishToFollowers returns {total, succeeded} (sse-publisher.ts:120-161) but partial failure handling not documented.
- [ ] Unread count cache race — Redis.incrUnreadCount fails after DB write, cache becomes stale with no recovery (notification.ts:56-57)
- [x] Unhandled promise rejection chains — covered in error-handling-promise-patterns.md
- [x] Unread count cache strategy — covered in caching-unread-count-strategy.md
- [x] Request correlation flow — covered in logging-request-correlation.md
- [x] SSE replay buffer exhaustion — covered in sse-replay-buffer-exhaustion.md
- [x] Feed cache ignores limit parameter — covered in caching-feed-limit-ignored.md
- [x] Tombstone lifecycle — covered in caching-tombstone-filtering.md (TTL coordination section, EXPIRE reset behavior, Redis restart lifecycle)
- [x] $queryRaw patterns — covered in database-queryraw-patterns.md
- [x] Lua script atomicity — covered in caching-lua-atomicity.md (I5, G1 mention error handling; detailed coverage in error-handling-redis-failure-policy.md)
- [x] Feed version initialization race — covered in error-handling-failopen-null-checks.md
- [x] SSE connection limit — covered in sse-connection-limit-rationale.md
- [x] Rate limiter retry-after calculation — covered in security-rate-limit-retry-after.md
- [x] Feed assembly — covered in caching-feed-assembly.md
- [x] Cursor pagination — covered in pagination-cursor-encoding.md
- [x] PostgreSQL connection failure handling — covered in error-handling-subsystem-failure-policies.md
- [x] S3 pre-signed URL failure handling — covered in error-handling-subsystem-failure-policies.md
- [x] Media URL validation and orphan handling — covered in error-handling-subsystem-failure-policies.md

## Medium (patterns, consistency, edge cases)
- [ ] IP extraction patterns duplication — duplicate logic in middleware (index.ts:61-64) and auth router (auth.ts:23-28), header precedence (x-forwarded-for → x-real-ip → unknown) not documented
- [ ] Rate limiting integration — which procedures use which limits, failClosed flag usage in practice not documented (rate-limiter.ts:20-25)
- [ ] Search input sanitization edge cases — SQL wildcard stripping before length validation causes empty string edge case (search.ts:24-51)
- [x] Cursor parsing validation — covered in pagination-cursor-validation.md — base64url decode → JSON parse → type validation pattern (search.ts:59-106, feed.ts:33-41)
- [x] Promise.allSettled best-effort patterns — covered in error-handling-promise-patterns.md
- [ ] P2002 type guard pattern inconsistency — inline type guards in engagement.ts:97, notification.ts:80; tweet.ts doesn't check P2002 on create, handles in catch
- [ ] Prisma transaction type assertions — pattern for typed transaction results not documented (tweet.ts:127-140 with explicit type assertion)
- [ ] Ownership validation pattern — if (tweet.authorId !== userId) throw FORBIDDEN pattern in tweet.ts:238-244 not documented
- [ ] Deleted tweet filtering consistency — some queries check deleted: true, others don't; no documented policy on enforcement points (feed.ts, search.ts, engagement.ts)
- [ ] Feed cache versioning edge cases — versioning interaction with concurrent invalidation not fully specified, tombstone lifecycle after Redis restart not fully covered
- [ ] SSE Lua script lifecycle — loads Lua script from filesystem once (sse-publisher.ts:46-63), caches in module variable; failure behavior (throws during first event publish), in-memory fallback semantics, recovery if script file deleted at runtime not documented
- [ ] Cursor field schemas — search cursor (tweetId, relevance), feed cursor (effectiveAt, tweetId) formats not specified; cursor expiration/invalidation not documented
- [ ] Feed hydration batch pattern — two separate IN queries for hasLiked/hasRetweeted (feed.ts:119-131); why two queries vs one JOIN, performance impact of two round-trips, deduplication with retweeted content interaction not documented
- [ ] Client-side form validation patterns — field-level error clearing, dynamic password strength feedback (register-form.tsx:28-70)
- [ ] Nonce/RequestID propagation — x-nonce + x-request-id via request headers not response headers (middleware.ts:51-54)
- [ ] SSE event type versioning — backward compatibility strategy for event format changes not documented
- [ ] Notification deduplication key formula — dedupeKey: "like:${userId}:${tweetId}" (notification.ts:83); format and custom key semantics not documented; idempotency with revisit/undo unclear
- [ ] Optimistic UI state sync — useEffect pattern for prop→state sync, mutation ordering not documented
- [ ] Structured logging inconsistency — middleware console.warn vs tRPC log.warn/error abstraction not documented
- [ ] Mention parsing service — @mention regex extraction (mention.ts:22) with username length 3-15 chars; no documented rationale for constraint or cross-reference with User.username schema
- [ ] OAuth username generation collision avoidance — truncate to 9 chars (8 + underscore + 6 CUID prefix) in lib/utils.ts:62-75; rationale for 9-char limit and CUID prefix need not documented
- [ ] Soft-delete enforcement — tweet.deleted filtering in queries not documented
- [ ] Engagement count denormalization — atomic update pattern in transactions not documented
- [ ] bumpFeedVersion naming — bumpFeedVersionForFollowers vs bumpFeedVersion usage distinction (feed.ts:466-484 vs social.ts:377-380)
- [x] P2002/P2025 race handling — covered in error-handling-prisma-race-conditions.md
- [ ] SSE client reconnect strategy — use-sse.ts exponential backoff, Last-Event-ID replay, polling fallback; reconnection timing (initial delay, max backoff), 3-strike polling fallback trigger, Last-Event-ID semantics with replay buffer, connection loss vs frame parse error distinction not documented
- [ ] Image utilities client-side canvas operations — image-utils.ts cover-crop algorithm, JPEG quality 0.95, memory impact
- [ ] Redis session invalidation error handling — auth.ts:288 silent .catch on sessionDel, fail-open/closed policy
- [ ] Lua script loading and caching — sse-publisher.ts:44-62 singleton pattern, script not found handling
- [x] Error handling philosophy — covered in error-handling-subsystem-failure-policies.md
- [ ] Race condition handling with updateMany pattern — tweet.ts:249-264 uses updateMany with where: {id, deleted: false} to detect concurrent delete; references auth.ts:269-296 pattern; should be extracted to dedicated spec on concurrent mutation idempotency

## Low (polish, optimization, developer experience)
- [ ] Image loading fallback — Avatar onError to /placeholder-avatar.png pattern (avatar.tsx:20-25, 43)
- [ ] Type guard patterns — defensive null checks, IP extraction with fallbacks, early exits (auth.ts:24-28, engagement.ts:512, feed.ts:71)
- [ ] Media upload retry strategy — S3 partial object cleanup, pre-signed URL timeout not documented
- [ ] Modal focus restoration — edge case when previousActiveElement removed from DOM not documented
- [ ] Infinite scroll threshold — IntersectionObserver margin/threshold settings not documented
- [ ] SSE in-memory fallback — behavior when Redis unavailable not documented
- [ ] CSRF origin validation edge cases — Edge Runtime constraints, env parsing not documented
- [ ] Image EXIF handling — metadata sanitization, size limits not documented
- [ ] Risks & mitigations — §7 from plan not documented in specs
- [ ] Performance targets — §9 from plan not documented in specs

## Spec File Maintenance (broken file:line references)
- [x] testing-e2e-page-objects.md — fixed broken file:line references (commit 4267b5d)
- [ ] logging-structured-output-redaction.md line 9 — claims src/lib/logger.ts:1-62 but file has 61 lines (off-by-one)
- [ ] security-input-validation.md line 9 — claims src/lib/validators.ts:1-62 but file has 61 lines (off-by-one)
- [ ] sse-connection-management.md line 9 — claims src/hooks/use-sse.ts:41-259 but file has 245 lines (off by 14)
- [ ] caching-feed-versioning.md line 9 — unfollow version bump line reference off by ~18 lines (says 168, should be 186)
- [ ] database-queryraw-patterns.md line 16 — social.ts getSuggestions query range too broad (says 317-371, should be 327-369)
- [ ] pagination-cursor-encoding.md line 14 — engagement.ts parseLikeCursor off by ~44 lines (says 497-511, should be 555-564)
- [ ] pagination-cursor-encoding.md line 15 — tweet.ts getReplies range off by ~14 lines (says 374-426, should be 418-450); getUserTweets not in specified range (should add separate entry at 533-564)

## Plan vs Implementation Discrepancies
- [ ] tweetContentSchema validators.ts:16 — plan §1.15 line 351 specifies z.string().min(1).max(280) but implementation has z.string().max(280) (missing .min(1)); mitigated by runtime check in tweet router but violates spec

## TODO Comments in Source (implementation gaps, not docs)
File beads for these — do not document in specs:
- [ ] engagement-buttons.tsx:139 — quote tweet modal
- [ ] engagement-buttons.tsx:155 — toast notification
- [ ] mobile-bottom-nav.tsx:44 — unread count connection
- [ ] user-list.tsx:96 — isFollowing state fetching
- [ ] follow-button.tsx:77 — login modal redirect
- [ ] tweet.ts:212 — SSE event marker (E1) for tweet_deleted publishing
