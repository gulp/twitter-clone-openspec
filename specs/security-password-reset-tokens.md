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
2. **Fetch token record** — `findUnique` by tokenHash with user relation (src/server/trpc/routers/auth.ts:249-252)
3. **Validate token** — Three checks BEFORE transaction (src/server/trpc/routers/auth.ts:254-274):
   - Token exists (src/server/trpc/routers/auth.ts:255)
   - Token not already used (src/server/trpc/routers/auth.ts:262)
   - Token not expired (src/server/trpc/routers/auth.ts:269)
4. **Hash new password** — bcrypt with cost 12 (src/server/trpc/routers/auth.ts:277)
5. **Atomic update** — `$transaction` with two operations (src/server/trpc/routers/auth.ts:281-296):
   - Update user password + increment sessionVersion (invalidates all sessions)
   - Mark token as used

### Race Condition (TOCTOU)

**Issue:** Validation happens outside the transaction (src/server/trpc/routers/auth.ts:254-274), creating a time-of-check-time-of-use (TOCTOU) vulnerability.

**Attack scenario:**
```
Time 0: Attacker submits password reset request, receives token via email
Time 1: Attacker sends completeReset(token, "password1") — Request A
Time 1: Attacker sends completeReset(token, "password2") — Request B (concurrent)
Time 2: Request A reads token (used=false) ✓
Time 2: Request B reads token (used=false) ✓
Time 3: Request A enters transaction, sets password="password1", marks used=true
Time 4: Request B enters transaction, sets password="password2", marks used=true
Result: Attacker's password ends up as "password2" (B wins race)
```

**Severity:** Low to Medium
- Requires attacker to already possess valid reset token (email access)
- Timing window is narrow (milliseconds between validation and transaction)
- Both password changes are attacker-controlled; no unintended access granted
- However, attacker can determine final password with high probability via request flooding

**Mitigation (not implemented):**
Option A — Atomic check-and-update using `updateMany`:
```typescript
const updated = await prisma.passwordResetToken.updateMany({
  where: {
    tokenHash,
    used: false,              // ← Atomic check
    expiresAt: { gt: new Date() }
  },
  data: { used: true }
});

if (updated.count === 0) {
  throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired reset token" });
}
```

Option B — Serializable transaction isolation (PostgreSQL default is READ COMMITTED):
```typescript
await prisma.$transaction(async (tx) => {
  const token = await tx.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });
  // Validation + updates here
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
```

## Invariants

1. **Single-use enforcement** — Token can only reset password once (checked but vulnerable to race)
2. **Expiry enforcement** — Token expires 1 hour after creation
3. **Hash-only storage** — Raw token NEVER stored in database; only SHA-256 hash persisted
4. **Prior token invalidation** — Requesting new reset invalidates all prior active tokens for that user
5. **Session invalidation on reset** — Password reset increments sessionVersion, logging out all devices
6. **Timing attack resistance** — Response time always ≥200ms, same message for valid/invalid emails
7. **Cryptographic randomness** — Tokens generated with `crypto.randomBytes` (CSPRNG)

## Gotchas

1. **Race condition on concurrent resets** — Two simultaneous `completeReset` requests with same token can both succeed (see TOCTOU above)
2. **Email delivery is fire-and-forget** — Email send never awaited; no retry, no delivery confirmation (src/server/trpc/routers/auth.ts:219)
3. **Timing validation happens outside transaction** — `used` and `expiresAt` checks (src/server/trpc/routers/auth.ts:262, 269) are separate queries before transaction
4. **Token invalidation is not transactional with generation** — `updateMany` (src/server/trpc/routers/auth.ts:191) + `create` (src/server/trpc/routers/auth.ts:207) are separate operations; crash between them leaves old tokens active
5. **No rate limiting on completeReset** — Only `requestReset` is rate-limited; attacker with token can flood `completeReset`
6. **bcrypt cost is hardcoded** — Cost factor 12 (src/server/trpc/routers/auth.ts:277) not configurable; future changes require code edit
7. **Token in URL** — Reset token sent as URL query parameter (src/server/trpc/routers/auth.ts:216); may leak in browser history, server logs, HTTP referrer headers
8. **No token rotation** — Partially-used token not rotated; if attacker intercepts POST body mid-flight, original token still valid until marked used
9. **No dummy hash for non-existent users** — Non-existent user path is faster (no bcrypt operation), creating timing oracle despite 200ms minimum enforcement
10. **Generic error messages** — All three validation failures (invalid/used/expired) return same message (src/server/trpc/routers/auth.ts:255, 262, 269); prevents user from distinguishing expiry vs. already-used

## Security Considerations

### Strengths
- Cryptographically secure token generation (32 bytes = 256 bits entropy)
- Hash-only storage prevents token theft via DB dump
- Timing-attack mitigation via minimum 200ms response time
- Session invalidation on password change prevents session fixation
- Prior token invalidation limits exposure window

### Weaknesses
- **TOCTOU race condition** — Concurrent requests can bypass single-use check
- **Email delivery unreliable** — Fire-and-forget means user may never receive token (see security-email-timing-safety.md)
- **Token in URL** — Query parameter exposure in logs/history
- **No rate limit on consumption** — Attacker with token can brute-force concurrent requests
- **Timing oracle on email existence** — 200ms minimum doesn't eliminate timing variance; non-existent user path is faster (no bcrypt, no DB writes), existing user path has variable DB latency

### Recommendations
1. Implement atomic check-and-update (Option A above) to eliminate race
2. Add rate limiting to `completeReset` (e.g., 3 attempts per token)
3. Consider using POST body for token instead of URL parameter
4. Add email delivery confirmation or retry queue for production
5. Log failed `completeReset` attempts for abuse monitoring
