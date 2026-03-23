# specs/ Index

Cross-cutting documentation derived from `src/` code. One file per topic, prefixed by theme.

## Themes

| Prefix | Theme | Status |
|--------|-------|--------|
| `error-handling-` | Error patterns, fail-open/closed, Prisma error codes | done |
| `security-` | CSRF, rate limiting, auth, input validation | done |
| `caching-` | Redis strategy, feed versioning, TTL, fallback | done |
| `pagination-` | Cursor encoding, keyset patterns, Prisma cursor | done |
| `sse-` | Publisher, replay buffer, client reconnect | done |
| `optimistic-` | Mutation callbacks, rollback, cache invalidation | done |
| `testing-` | Helpers, integration patterns, E2E fixtures | done |
| `logging-` | Structured JSON, request correlation, redaction | done |
| `engagement-` | Like/retweet/quote patterns, counts, notifications | partial |

## Files

<!-- Workers append entries here as they complete each theme -->

- [error-handling-trpc-codes.md](error-handling-trpc-codes.md) — TRPCError code hierarchy, logging by severity, client error messages
- [error-handling-prisma-race-conditions.md](error-handling-prisma-race-conditions.md) — P2002/P2025 handling for idempotent mutations, concurrent request races
- [error-handling-redis-failure-policy.md](error-handling-redis-failure-policy.md) — Fail-open vs fail-closed strategy, auth rate limiting, cache degradation
- [error-handling-failopen-null-checks.md](error-handling-failopen-null-checks.md) — Null return handling from fail-open wrappers, version initialization race fix, defensive fallback patterns
- [error-handling-validation.md](error-handling-validation.md) — Zod schema validation, business rule checks, authorization vs input errors
- [error-handling-promise-patterns.md](error-handling-promise-patterns.md) — Promise.all() fail-fast vs Promise.allSettled() best-effort patterns, fail-open group error handling, concurrent operation trade-offs
- [error-handling-subsystem-failure-policies.md](error-handling-subsystem-failure-policies.md) — Subsystem failure matrix (PostgreSQL/Redis/S3/Email/SSE), retry policy, media URL validation, orphan handling
- [security-csrf-and-headers.md](security-csrf-and-headers.md) — Origin header CSRF protection, CSP with nonces, request ID propagation
- [security-csrf-origin.md](security-csrf-origin.md) — CSRF protection via Origin header validation in Edge middleware
- [security-rate-limiting.md](security-rate-limiting.md) — Redis sliding-window rate limiter with fail-open/fail-closed policies
- [security-rate-limit-retry-after.md](security-rate-limit-retry-after.md) — Retry-After calculation in Lua script, oldest-entry expiry math, HTTP 429 response format, edge case handling (clock skew, empty ZSET)
- [security-auth-and-sessions.md](security-auth-and-sessions.md) — Three-layer session validation, timing-safe auth, password reset tokens, OAuth username generation
- [security-session-management.md](security-session-management.md) — JWT + Redis allow-list + sessionVersion for multi-layer session validation
- [security-password-reset-tokens.md](security-password-reset-tokens.md) — Password reset flow with SHA-256 token hashing, TOCTOU race condition analysis, timing-attack resistance, single-use enforcement
- [security-email-timing-safety.md](security-email-timing-safety.md) — Fire-and-forget email pattern for timing attack prevention, SMTP best-effort delivery, minimum response time enforcement
- [security-env-validation-edge-runtime.md](security-env-validation-edge-runtime.md) — Edge Runtime environment validation gap, fail-closed CSRF with missing APP_ORIGIN, silent misconfiguration detection
- [security-timing-attacks.md](security-timing-attacks.md) — Constant-time comparison and response timing flattening for auth endpoints
- [security-password-validation.md](security-password-validation.md) — Password validation with length constraints, Unicode normalization gaps, homograph attack risks, bcrypt byte truncation behavior
- [security-input-validation.md](security-input-validation.md) — Zod schemas, field validators, pagination defaults, tRPC integration
- [caching-feed-versioning.md](caching-feed-versioning.md) — Monotonic version counters for cache invalidation, follower feed bumping, cursor hash determinism
- [caching-ttl-strategy.md](caching-ttl-strategy.md) — TTL values for feed pages (60s), sessions (30d), replay buffers (5m), suggestions (5m), tombstones (60s)
- [caching-redis-key-patterns.md](caching-redis-key-patterns.md) — Naming convention, TTL strategy, atomic operations, SETNX locking, data type inventory
- [caching-tombstone-filtering.md](caching-tombstone-filtering.md) — In-memory filtering of soft-deleted tweets from cached feeds using Redis tombstones set
- [caching-feed-assembly.md](caching-feed-assembly.md) — Fan-out-on-read with DISTINCT ON deduplication, versioned caching, tombstone filtering, SETNX locking, batch hydration
- [caching-feed-limit-ignored.md](caching-feed-limit-ignored.md) — Feed cache key excludes limit parameter, cache hit returns original page size, inconsistent pagination behavior, hit rate optimization trade-offs
- [caching-lua-atomicity.md](caching-lua-atomicity.md) — Lua scripts for atomic rate limiting and floored unread count decrement
- [caching-data-structure-selection.md](caching-data-structure-selection.md) — Choosing STRING vs SET vs ZSET vs LIST for different caching patterns with performance characteristics
- [caching-wrapper-functions.md](caching-wrapper-functions.md) — Typed Redis wrappers with fail-open/fail-closed policies, structured logging, requestId correlation, Lua atomicity
- [caching-connection-resilience.md](caching-connection-resilience.md) — Redis singleton pattern, exponential backoff retry strategy, dev-mode hot-reload safety, automatic reconnection
- [caching-cache-aside-pattern.md](caching-cache-aside-pattern.md) — Read-through cache pattern for query results, JSON serialization, TTL + explicit invalidation, fail-open error handling
- [caching-unread-count-strategy.md](caching-unread-count-strategy.md) — Unread notification count caching with DB fallback, Lua atomic decrement, cache-aside backfill, no TTL invalidation
- [caching-key-construction.md](caching-key-construction.md) — Cache key uniqueness principles, parameter inclusion rules, cursor hashing, deterministic serialization
- [caching-json-parsing-safety.md](caching-json-parsing-safety.md) — JSON.parse trust model for cached data vs user cursors, fail-open/fail-closed patterns, corruption handling, type coercion gotchas
- [pagination-cursor-encoding.md](pagination-cursor-encoding.md) — Opaque base64url cursors, keyset pagination patterns, Prisma vs custom encoding, peek-ahead strategy
- [pagination-cursor-validation.md](pagination-cursor-validation.md) — Base64url decode → JSON parse → type validation patterns, Zod transforms vs standalone parsers, error conversion, Date/NaN edge cases
- [pagination-where-clause-construction.md](pagination-where-clause-construction.md) — Compound cursor WHERE clause pattern, lexicographic comparison, row syntax, null handling, peek-ahead
- [database-queryraw-patterns.md](database-queryraw-patterns.md) — $queryRaw usage for full-text search, CTEs, DISTINCT ON, UNION, Prisma.sql safe interpolation, type casting, row-value comparisons
- [engagement-quote-tweet-design.md](engagement-quote-tweet-design.md) — Quote tweet as standalone entity vs engagement count, no quoteCount denormalization, feed version behavior, notification semantics, hydration gaps
- [sse-event-publishing.md](sse-event-publishing.md) — Atomic Lua script for event publishing, Redis Pub/Sub channels, sequence numbers, replay buffer, fan-out to followers
- [sse-connection-management.md](sse-connection-management.md) — Client reconnect with exponential backoff, Last-Event-ID replay, connection limits, heartbeat, SIGTERM draining
- [sse-graceful-shutdown.md](sse-graceful-shutdown.md) — SIGTERM handler for zero-downtime deployments, server_restart event notification, client reconnect flow, rolling restart behavior
- [sse-replay-buffer-exhaustion.md](sse-replay-buffer-exhaustion.md) — Replay buffer overflow (>200 events) and TTL expiration (5min), missed event scenarios, client fallback polling, gap detection
- [sse-connection-limit-rationale.md](sse-connection-limit-rationale.md) — 5-connection-per-user limit rationale, multi-device usage patterns, resource exhaustion prevention, fail-open Redis degradation, race condition analysis
- [optimistic-ui-mutation-pattern.md](optimistic-ui-mutation-pattern.md) — tRPC mutation lifecycle (onMutate/onError/onSuccess), local state sync, rollback pattern, query invalidation
- [testing-integration-helpers.md](testing-integration-helpers.md) — Test data factories, tRPC caller creation, database/Redis cleanup, unique IP generation, log capture for assertions
- [testing-e2e-page-objects.md](testing-e2e-page-objects.md) — Page Object pattern for E2E tests, fixture integration, data-testid selectors, action/assertion separation
- [logging-request-correlation.md](logging-request-correlation.md) — UUIDv4 requestId propagation via AsyncLocalStorage from tRPC context through Prisma/Redis for distributed tracing
- [logging-structured-output-redaction.md](logging-structured-output-redaction.md) — Structured JSON logger with automatic credential redaction, log level guidelines, standard context fields
- [logging-error-classification.md](logging-error-classification.md) — tRPC middleware error classification by severity, IP extraction for security events, slow query detection, context enrichment
