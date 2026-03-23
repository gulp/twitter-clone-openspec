# Password Reset Token Security

## What

Password reset flow using cryptographically secure tokens with SHA-256 hashing, expiry enforcement, single-use guarantees, and timing-attack resistance. Tokens are 32-byte random values delivered via email, with only the SHA-256 hash stored in the database.

## Where

- Token generation: `src/server/trpc/routers/auth.ts:200-213`
- Token validation & consumption: `src/server/trpc/routers/auth.ts:242-301`
- Email delivery: `src/server/services/email.ts` (fire-and-forget)
- Schema: `prisma/schema.prisma` (`PasswordResetToken` model)

## How It Works

### Token Generation Flow (`requestReset`)

1. **Rate limiting** — 5 requests per 15 minutes per IP (src/server/trpc/routers/auth.ts:158-168)
2. **Timing-attack resistance** — Enforced minimum 200ms response time (src/server/trpc/routers/auth.ts:222-226) to prevent timing oracle on email existence
3. **Invalidate prior tokens** — All active (unused + non-expired) tokens for the user are marked `used: true` via `updateMany` (src/server/trpc/routers/auth.ts:191-198)
4. **Generate token** — 32 random bytes from `crypto.randomBytes`, hex-encoded (64 chars) (src/server/trpc/routers/auth.ts:201)
5. **Hash for storage** — SHA-256 hash of raw token stored in DB (src/server/trpc/routers/auth.ts:202); raw token NEVER persisted
6. **Store token record** — Create `PasswordResetToken` with hash, userId, expiresAt (1 hour TTL) (src/server/trpc/routers/auth.ts:207-213)
7. **Email delivery** — Fire-and-forget `sendPasswordResetEmail` (never awaited) with raw token in URL (src/server/trpc/routers/auth.ts:216-219)
8. **Generic response** — Always returns same message regardless of email existence (src/server/trpc/routers/auth.ts:229-232)

### Token Consumption Flow (`completeReset`)

1. **Hash incoming token** — SHA-256 hash of user-provided token for DB lookup (src/server/trpc/routers/auth.ts:246)
2. **Hash new password** — bcrypt with cost 12, computed before transaction (src/server/trpc/routers/auth.ts:252)
3. **Atomic validation and update** — `$transaction` with SELECT FOR UPDATE row locking (src/server/trpc/routers/auth.ts:255-310):
   - **Lock token row** — `$queryRaw` with `FOR UPDATE` clause acquires exclusive row lock (src/server/trpc/routers/auth.ts:258-265)
   - **Validate token** — Three checks INSIDE transaction after locking:
     - Token exists (src/server/trpc/routers/auth.ts:267-272)
     - Token not already used (src/server/trpc/routers/auth.ts:277-282)
     - Token not expired (src/server/trpc/routers/auth.ts:285-290)
   - **Mark token as used** (src/server/trpc/routers/auth.ts:293-296)
   - **Update user password** + increment sessionVersion to invalidate all sessions (src/server/trpc/routers/auth.ts:299-305)

### Race Condition Prevention (SELECT FOR UPDATE)

The implementation uses PostgreSQL row-level locking to prevent TOCTOU (time-of-check-time-of-use) race conditions on concurrent password reset attempts with the same token.

**Locking mechanism:**
```typescript
const lockedTokens = await tx.$queryRaw`
  SELECT "tokenHash", "userId", "used", "expiresAt"
  FROM "PasswordResetToken"
  WHERE "tokenHash" = ${tokenHash}
  FOR UPDATE
`;
```

The `FOR UPDATE` clause (src/server/trpc/routers/auth.ts:264) acquires an exclusive row lock that:
- Blocks other transactions from reading the row until the current transaction commits or rolls back
- Prevents concurrent requests from validating the same token simultaneously
- Guarantees only one request can proceed past validation

**Why this works:**
1. Request A acquires lock on token row → validates → marks used → commits
2. Request B waits for lock → acquires lock after A commits → sees used=true → throws error

**Alternative approaches considered:**
- `updateMany` with atomic WHERE conditions — Would work but requires separate query to fetch userId
- Serializable isolation level — Overkill; row-level locking is sufficient and more performant

## Invariants

1. **Single-use enforcement** — Token can only reset password once (enforced via SELECT FOR UPDATE row locking)
2. **Expiry enforcement** — Token expires 1 hour after creation
3. **Hash-only storage** — Raw token NEVER stored in database; only SHA-256 hash persisted
4. **Prior token invalidation** — Requesting new reset invalidates all prior active tokens for that user
5. **Session invalidation on reset** — Password reset increments sessionVersion, logging out all devices
6. **Timing attack resistance** — Response time always ≥200ms, same message for valid/invalid emails
7. **Cryptographic randomness** — Tokens generated with `crypto.randomBytes` (CSPRNG)
8. **Race-free validation** — SELECT FOR UPDATE prevents concurrent requests from bypassing single-use check

## Gotchas

1. **Email delivery is fire-and-forget** — Email send never awaited; no retry, no delivery confirmation (src/server/trpc/routers/auth.ts:219)
2. **Token invalidation is not transactional with generation** — `updateMany` (src/server/trpc/routers/auth.ts:191) + `create` (src/server/trpc/routers/auth.ts:207) are separate operations; crash between them leaves old tokens active
3. **SELECT FOR UPDATE blocks concurrent requests** — Second request waits for first to complete; under high load this creates queueing. PostgreSQL lock timeout (default 0 = wait forever) means no automatic retry.
4. **No rate limiting on completeReset** — Only `requestReset` is rate-limited; attacker with token can flood `completeReset`
5. **bcrypt cost is hardcoded** — Cost factor 12 (src/server/trpc/routers/auth.ts:252) not configurable; future changes require code edit
6. **Token in URL** — Reset token sent as URL query parameter (src/server/trpc/routers/auth.ts:216); may leak in browser history, server logs, HTTP referrer headers
7. **No token rotation** — Partially-used token not rotated; if attacker intercepts POST body mid-flight, original token still valid until marked used
8. **No dummy hash for non-existent users** — Non-existent user path is faster (no bcrypt operation), creating timing oracle despite 200ms minimum enforcement
9. **Generic error messages** — All three validation failures (invalid/used/expired) return same message (src/server/trpc/routers/auth.ts:268-290); prevents user from distinguishing expiry vs. already-used

## Security Considerations

### Strengths
- Cryptographically secure token generation (32 bytes = 256 bits entropy)
- Hash-only storage prevents token theft via DB dump
- Timing-attack mitigation via minimum 200ms response time
- Session invalidation on password change prevents session fixation
- Prior token invalidation limits exposure window
- **SELECT FOR UPDATE row locking** — Prevents TOCTOU race conditions on concurrent token consumption

### Weaknesses
- **Email delivery unreliable** — Fire-and-forget means user may never receive token (see security-email-timing-safety.md)
- **Token in URL** — Query parameter exposure in logs/history
- **No rate limit on consumption** — Attacker with token can flood `completeReset` (mitigated by lock contention)
- **Timing oracle on email existence** — 200ms minimum doesn't eliminate timing variance; non-existent user path is faster (no bcrypt, no DB writes), existing user path has variable DB latency

### Recommendations
1. Add rate limiting to `completeReset` (e.g., 3 attempts per token)
2. Consider using POST body for token instead of URL parameter
3. Add email delivery confirmation or retry queue for production
4. Log failed `completeReset` attempts for abuse monitoring
5. Consider lock timeout configuration for SELECT FOR UPDATE to prevent indefinite waits under DoS
