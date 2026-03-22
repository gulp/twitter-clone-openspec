# specs/ Index

Cross-cutting documentation derived from `src/` code. One file per topic, prefixed by theme.

## Themes

| Prefix | Theme | Status |
|--------|-------|--------|
| `error-handling-` | Error patterns, fail-open/closed, Prisma error codes | done |
| `security-` | CSRF, rate limiting, auth, input validation | done |
| `caching-` | Redis strategy, feed versioning, TTL, fallback | pending |
| `pagination-` | Cursor encoding, keyset patterns, Prisma cursor | pending |
| `sse-` | Publisher, replay buffer, client reconnect | pending |
| `optimistic-` | Mutation callbacks, rollback, cache invalidation | pending |
| `testing-` | Helpers, integration patterns, E2E fixtures | done |
| `logging-` | Structured JSON, request correlation, redaction | pending |

## Files

<!-- Workers append entries here as they complete each theme -->

- [error-handling-trpc-codes.md](error-handling-trpc-codes.md) — TRPCError code hierarchy, logging by severity, client error messages
- [error-handling-prisma-race-conditions.md](error-handling-prisma-race-conditions.md) — P2002/P2025 handling for idempotent mutations, concurrent request races
- [error-handling-redis-failure-policy.md](error-handling-redis-failure-policy.md) — Fail-open vs fail-closed strategy, auth rate limiting, cache degradation
- [error-handling-validation.md](error-handling-validation.md) — Zod schema validation, business rule checks, authorization vs input errors
- [security-csrf-and-headers.md](security-csrf-and-headers.md) — Origin header CSRF protection, CSP with nonces, request ID propagation
- [security-csrf-origin.md](security-csrf-origin.md) — CSRF protection via Origin header validation in Edge middleware
- [security-rate-limiting.md](security-rate-limiting.md) — Redis sliding-window rate limiter with fail-open/fail-closed policies
- [security-auth-and-sessions.md](security-auth-and-sessions.md) — Three-layer session validation, timing-safe auth, password reset tokens, OAuth username generation
- [security-session-management.md](security-session-management.md) — JWT + Redis allow-list + sessionVersion for multi-layer session validation
- [security-timing-attacks.md](security-timing-attacks.md) — Constant-time comparison and response timing flattening for auth endpoints
- [security-input-validation.md](security-input-validation.md) — Zod schemas, field validators, pagination defaults, tRPC integration
- [caching-feed-versioning.md](caching-feed-versioning.md) — Monotonic version counters for cache invalidation, follower feed bumping, cursor hash determinism
- [caching-ttl-strategy.md](caching-ttl-strategy.md) — TTL values for feed pages (60s), sessions (30d), replay buffers (5m), suggestions (5m), tombstones (60s)
- [caching-redis-key-patterns.md](caching-redis-key-patterns.md) — Naming convention, TTL strategy, atomic operations, SETNX locking, data type inventory
- [caching-tombstone-filtering.md](caching-tombstone-filtering.md) — In-memory filtering of soft-deleted tweets from cached feeds using Redis tombstones set
- [caching-feed-assembly.md](caching-feed-assembly.md) — Fan-out-on-read with DISTINCT ON deduplication, versioned caching, tombstone filtering, SETNX locking, batch hydration
- [caching-lua-atomicity.md](caching-lua-atomicity.md) — Lua scripts for atomic rate limiting and floored unread count decrement
- [caching-data-structure-selection.md](caching-data-structure-selection.md) — Choosing STRING vs SET vs ZSET vs LIST for different caching patterns with performance characteristics
- [pagination-cursor-encoding.md](pagination-cursor-encoding.md) — Opaque base64url cursors, keyset pagination patterns, Prisma vs custom encoding, peek-ahead strategy
- [sse-event-publishing.md](sse-event-publishing.md) — Atomic Lua script for event publishing, Redis Pub/Sub channels, sequence numbers, replay buffer, fan-out to followers
- [sse-connection-management.md](sse-connection-management.md) — Client reconnect with exponential backoff, Last-Event-ID replay, connection limits, heartbeat, SIGTERM draining
- [optimistic-ui-mutation-pattern.md](optimistic-ui-mutation-pattern.md) — tRPC mutation lifecycle (onMutate/onError/onSuccess), local state sync, rollback pattern, query invalidation
- [testing-integration-helpers.md](testing-integration-helpers.md) — Test data factories, tRPC caller creation, database/Redis cleanup, unique IP generation, log capture for assertions
- [testing-e2e-page-objects.md](testing-e2e-page-objects.md) — Page Object pattern for E2E tests, fixture integration, data-testid selectors, action/assertion separation
- [logging-request-correlation.md](logging-request-correlation.md) — UUIDv4 requestId propagation via AsyncLocalStorage from tRPC context through Prisma/Redis for distributed tracing
