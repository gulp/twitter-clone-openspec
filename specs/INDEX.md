# specs/ Index

Cross-cutting documentation derived from `src/` code. One file per topic, prefixed by theme.

## Themes

| Prefix | Theme | Status |
|--------|-------|--------|
| `error-handling-` | Error patterns, fail-open/closed, Prisma error codes | done |
| `security-` | CSRF, rate limiting, auth, input validation | pending |
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
