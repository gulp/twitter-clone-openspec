# Documentation Gaps

Sorted by priority. Checked items are addressed in existing specs.

## Critical (security, data integrity, auth)
- [x] Silent configuration validation — covered in security-env-validation-edge-runtime.md
- [x] Password reset token race condition — covered in security-password-reset-tokens.md
- [ ] Password sanitization rules — no Unicode normalization, forbidden characters, control char filtering not documented
- [ ] PII redaction policy — what gets redacted in logs (email, username, IP) not documented
- [x] Timing-safe auth patterns — covered in security-timing-attacks.md
- [x] Fire-and-forget email service — covered in security-email-timing-safety.md
- [ ] SIGTERM graceful shutdown — SSE connection draining on process exit not documented (sse/route.ts:40-57)
- [x] CSRF origin validation — covered in security-csrf-origin.md
- [x] Session management — covered in security-session-management.md

## High (core features, caching, pagination)
- [ ] Unhandled promise rejection chains — Promise.all() fail-fast vs allSettled() best-effort patterns (tweet.ts:143-150, feed.ts:475-477)
- [ ] Unread count cache strategy — DB fallback behavior not explicitly documented (redis.ts:316-328)
- [ ] Request correlation flow — middleware requestId vs tRPC fallback, AsyncLocalStorage pattern not documented
- [ ] SSE replay buffer exhaustion — what happens when 200-entry buffer fills or expires after 5min not documented
- [ ] Feed cache ignores limit parameter — undocumented behavior in cache key construction
- [ ] Tombstone lifecycle — TTL, cleanup strategy, garbage collection not documented
- [ ] $queryRaw patterns — when to use raw SQL, type casting, DISTINCT ON semantics not documented
- [ ] Lua script atomicity — error handling and fallback behavior not documented
- [ ] Feed version initialization race — Redis failure edge case not documented (fixed in ac116e7, needs spec)
- [ ] SSE connection limit — max 5 connections per user rationale not documented
- [ ] Rate limiter retry-after calculation — Lua math and HTTP 429 codes not documented
- [x] Feed assembly — covered in caching-feed-assembly.md
- [x] Cursor pagination — covered in pagination-cursor-encoding.md

## Medium (patterns, consistency, edge cases)
- [ ] Cursor parsing validation — base64url decode → JSON parse → type validation pattern (search.ts:59-106, feed.ts:33-41)
- [ ] Search input sanitization edge cases — SQL wildcard stripping before length validation causes empty string edge case (search.ts:24-51)
- [ ] Promise.allSettled best-effort patterns — SSE fan-out with partial failures, health checks (sse-publisher.ts:138, health/route.ts:28)
- [ ] Client-side form validation patterns — field-level error clearing, dynamic password strength feedback (register-form.tsx:28-70)
- [ ] Nonce/RequestID propagation — x-nonce + x-request-id via request headers not response headers (middleware.ts:51-54)
- [ ] SSE event type versioning — backward compatibility strategy for event format changes not documented
- [ ] Notification deduplication — dedupeKey computation formula (user+type? user+type+data?) not documented
- [ ] Optimistic UI state sync — useEffect pattern for prop→state sync, mutation ordering not documented
- [ ] Structured logging inconsistency — middleware console.warn vs tRPC log.warn/error abstraction not documented
- [ ] Mention parsing service — @mention regex extraction and user resolution not documented
- [ ] OAuth username generation — CUID prefix strategy not documented
- [ ] Soft-delete enforcement — tweet.deleted filtering in queries not documented
- [ ] Prisma transaction type assertions — pattern for typed transaction results not documented
- [ ] P2002 idempotent mutation pattern — type-guard pattern inconsistent across routers
- [ ] Engagement count denormalization — atomic update pattern in transactions not documented
- [ ] Batch engagement state checks — Promise.all + Set creation pattern not documented (§1.16 referenced but missing spec)
- [ ] User select patterns — publicUserSelect vs selfUserSelect not documented
- [ ] Full-text search implementation — tsvector generation and GIN index usage not documented
- [ ] CUID ID strategy — Prisma @default(cuid()) usage and properties not documented
- [x] P2002/P2025 race handling — covered in error-handling-prisma-race-conditions.md

## Low (polish, optimization, developer experience)
- [ ] Image loading fallback — Avatar onError to /placeholder-avatar.png pattern (avatar.tsx:20-25, 43)
- [ ] Type guard patterns — defensive null checks, IP extraction with fallbacks, early exits (auth.ts:24-28, engagement.ts:512, feed.ts:71)
- [ ] Media upload retry strategy — S3 partial object cleanup, pre-signed URL timeout not documented
- [ ] Modal focus restoration — edge case when previousActiveElement removed from DOM not documented
- [ ] Infinite scroll threshold — IntersectionObserver margin/threshold settings not documented
- [ ] SSE in-memory fallback — behavior when Redis unavailable not documented
- [ ] CSRF origin validation edge cases — Edge Runtime constraints, env parsing not documented
- [ ] Image EXIF handling — metadata sanitization, size limits not documented
- [ ] Search pagination — cursor pattern for FTS results not documented
- [ ] Risks & mitigations — §7 from plan not documented in specs
- [ ] Performance targets — §9 from plan not documented in specs

## Spec File Maintenance
- [x] testing-e2e-page-objects.md — fixed broken file:line references (commit 4267b5d)
- [ ] caching-feed-versioning.md line 9 — unfollow line reference off by ~8 lines (says 168, should be 176)

## TODO Comments in Source (implementation gaps, not docs)
File beads for these — do not document in specs:
- [ ] engagement-buttons.tsx:139 — quote tweet modal
- [ ] engagement-buttons.tsx:155 — toast notification
- [ ] mobile-bottom-nav.tsx:44 — unread count connection
- [ ] user-list.tsx:96 — isFollowing state fetching
- [ ] follow-button.tsx:77 — login modal redirect
- [ ] tweet.ts:190 — SSE event marker (E1)
