# Documentation Gaps

Sorted by priority. Checked items are addressed in existing specs.

## Critical (security, data integrity, auth)
- [x] Silent configuration validation — covered in security-env-validation-edge-runtime.md
- [x] Password reset token race condition — covered in security-password-reset-tokens.md
- [x] Password sanitization rules — covered in security-password-validation.md
- [x] PII redaction policy — covered in logging-structured-output-redaction.md (I-LOG2: no email/IP beyond userIds)
- [x] Timing-safe auth patterns — covered in security-timing-attacks.md
- [x] Fire-and-forget email service — covered in security-email-timing-safety.md
- [x] SIGTERM graceful shutdown — covered in sse-graceful-shutdown.md
- [x] CSRF origin validation — covered in security-csrf-origin.md
- [x] Session management — covered in security-session-management.md
- [ ] CUID vs CUID2 mismatch — Prisma schema uses @default(cuid()) but OAuth signup uses CUID2 createId() (src/server/auth.ts:194 vs prisma/schema.prisma)

## High (core features, caching, pagination)
- [x] Quote tweet design decisions — covered in engagement-quote-tweet-design.md
- [x] JSON parsing safety — covered in caching-json-parsing-safety.md
- [ ] Raw SQL parameter injection safety — template literal ${userId} in $queryRaw, Prisma escaping guarantees not audited (social.ts:317-371)
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
- [ ] Database CHECK constraints — NOT NULL, non-negative counts, soft-delete consistency, content/media requirement (prisma/migrations/*/migration.sql:239-246)
- [ ] Full-text search implementation — tsvector GENERATED column, GIN index, ts_rank usage (search.ts:131-188, migration.sql:220)

## Medium (patterns, consistency, edge cases)
- [ ] Fire-and-forget async patterns — void (async () => {})() for non-blocking operations used inconsistently (email.ts:94-126, sse-publisher.ts:120-161, api/sse/route.ts)
- [ ] Silent .catch() error suppression policy — when silent suppression acceptable vs requires logging (engagement-buttons.tsx:154, auth.ts sessionDel, api/sse/route.ts cleanup)
- [ ] SSE event publishing partial success — publishToFollowers returns {total, succeeded}, semantics of partial failure not documented (sse-publisher.ts:120-161)
- [ ] IP extraction patterns duplication — duplicate logic in middleware and auth router, header precedence not documented (index.ts:61-64, auth.ts:23-28)
- [ ] Rate limiting integration — which procedures use which limits, failClosed flag usage in practice not documented (rate-limiter.ts:20-24)
- [ ] Promise.allSettled vs Promise.all consistency — when to use each not unified (feed uses all, SSE uses allSettled, mentions use all) (sse-publisher.ts:138-140, feed.ts:312, tweet.ts:143-152)
- [x] Cursor parsing validation — covered in pagination-cursor-validation.md — base64url decode → JSON parse → type validation pattern (search.ts:59-106, feed.ts:33-41)
- [ ] Search input sanitization edge cases — SQL wildcard stripping before length validation causes empty string edge case (search.ts:24-51)
- [x] Promise.allSettled best-effort patterns — covered in error-handling-promise-patterns.md
- [ ] Client-side form validation patterns — field-level error clearing, dynamic password strength feedback (register-form.tsx:28-70)
- [ ] Nonce/RequestID propagation — x-nonce + x-request-id via request headers not response headers (middleware.ts:51-54)
- [ ] SSE event type versioning — backward compatibility strategy for event format changes not documented
- [ ] Notification deduplication — dedupeKey computation formula (user+type? user+type+data?) not documented
- [ ] Optimistic UI state sync — useEffect pattern for prop→state sync, mutation ordering not documented
- [ ] Structured logging inconsistency — middleware console.warn vs tRPC log.warn/error abstraction not documented
- [ ] Mention parsing service — @mention regex extraction and user resolution not documented (mention.ts:22, username length 3-15)
- [ ] OAuth username generation — truncate to 9 chars = 8 + underscore + 6 CUID prefix (lib/utils.ts:62-75)
- [ ] Soft-delete enforcement — tweet.deleted filtering in queries not documented
- [ ] Prisma transaction type assertions — pattern for typed transaction results not documented
- [ ] P2002 idempotent mutation pattern — type-guard pattern inconsistent across routers
- [ ] Engagement count denormalization — atomic update pattern in transactions not documented
- [ ] Batch engagement state checks — Promise.all + Set creation pattern not documented (§1.16 referenced but missing spec)
- [ ] bumpFeedVersion naming — bumpFeedVersionForFollowers vs bumpFeedVersion usage distinction (feed.ts:466-484 vs social.ts:377-380)
- [ ] User select patterns — publicUserSelect vs selfUserSelect not documented
- [ ] Search pagination cursor pattern — different payloads for tweets ({rank,ts,id}) vs users ({followerCount,id}) (search.ts)
- [x] P2002/P2025 race handling — covered in error-handling-prisma-race-conditions.md
- [ ] SSE client reconnect with polling fallback — use-sse.ts exponential backoff, Last-Event-ID replay, 3-strike polling fallback
- [ ] Image utilities client-side canvas operations — image-utils.ts cover-crop algorithm, JPEG quality 0.95, memory impact
- [ ] Redis session invalidation error handling — auth.ts:299 silent .catch on sessionDel, fail-open/closed policy
- [ ] Lua script loading and caching — sse-publisher.ts:44-62 singleton pattern, script not found handling
- [x] Error handling philosophy — covered in error-handling-subsystem-failure-policies.md

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

## Spec File Maintenance
- [x] testing-e2e-page-objects.md — fixed broken file:line references (commit 4267b5d)
- [ ] logging-structured-output-redaction.md line 9 — claims src/lib/logger.ts:1-62 but file has 61 lines (off-by-one)
- [ ] security-input-validation.md line 9 — claims src/lib/validators.ts:1-62 but file has 61 lines (off-by-one)
- [ ] sse-connection-management.md line 9 — claims src/hooks/use-sse.ts:41-259 but file has 245 lines (off by 14)
- [ ] caching-feed-versioning.md line 9 — unfollow line reference off by ~8 lines (says 168, should be 176)
- [ ] database-queryraw-patterns.md line 16 — social.ts:317-371 range too broad by ~12 lines (should be 317-359)
- [ ] pagination-cursor-encoding.md line 14 — engagement.ts:497-511 range off by ~13 lines (should be 510-518)
- [ ] pagination-cursor-encoding.md line 15 — tweet.ts:374-426 range starts too early by ~13 lines (should be 387-442)

## TODO Comments in Source (implementation gaps, not docs)
File beads for these — do not document in specs:
- [ ] engagement-buttons.tsx:139 — quote tweet modal
- [ ] engagement-buttons.tsx:155 — toast notification
- [ ] mobile-bottom-nav.tsx:44 — unread count connection
- [ ] user-list.tsx:96 — isFollowing state fetching
- [ ] follow-button.tsx:77 — login modal redirect
- [ ] tweet.ts:190 — SSE event marker (E1)
