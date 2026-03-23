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

## High (core features, caching, pagination)
- [x] Unhandled promise rejection chains — covered in error-handling-promise-patterns.md
- [x] Unread count cache strategy — covered in caching-unread-count-strategy.md
- [x] Request correlation flow — covered in logging-request-correlation.md
- [x] SSE replay buffer exhaustion — covered in sse-replay-buffer-exhaustion.md
- [x] Feed cache ignores limit parameter — covered in caching-feed-limit-ignored.md
- [x] Tombstone lifecycle — covered in caching-tombstone-filtering.md (TTL coordination section, EXPIRE reset behavior, Redis restart lifecycle)
- [x] $queryRaw patterns — covered in database-queryraw-patterns.md
- [x] Lua script atomicity — covered in caching-lua-atomicity.md (I5, G1 mention error handling; detailed coverage in error-handling-redis-failure-policy.md)
- [ ] Feed version initialization race — Redis failure edge case not documented (fixed in ac116e7, needs spec)
- [x] SSE connection limit — covered in sse-connection-limit-rationale.md
- [ ] Rate limiter retry-after calculation — Lua math and HTTP 429 codes not documented
- [x] Feed assembly — covered in caching-feed-assembly.md
- [x] Cursor pagination — covered in pagination-cursor-encoding.md

## Medium (patterns, consistency, edge cases)
- [ ] Cursor parsing validation — base64url decode → JSON parse → type validation pattern (search.ts:59-106, feed.ts:33-41)
- [ ] Search input sanitization edge cases — SQL wildcard stripping before length validation causes empty string edge case (search.ts:24-51)
- [x] Promise.allSettled best-effort patterns — covered in error-handling-promise-patterns.md
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
