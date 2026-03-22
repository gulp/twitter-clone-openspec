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
| `testing-` | Helpers, integration patterns, E2E fixtures | pending |
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
