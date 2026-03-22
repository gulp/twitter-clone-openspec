# Timing Attack Prevention

## What

Constant-time comparison and response timing flattening prevent attackers from using timing side-channels to enumerate accounts, guess passwords, or brute-force reset tokens. All auth-sensitive endpoints enforce minimum response delays and timing-safe bcrypt comparison.

## Where

- `src/server/auth.ts:92-104` — Timing-safe password comparison in CredentialsProvider
- `src/server/trpc/routers/auth.ts:155-233` — Password reset with 200ms minimum response time
- `src/server/trpc/routers/auth.ts:14-17` — sleep() helper for timing-attack prevention

## How It Works

### Password Verification (Login)

The CredentialsProvider always runs bcrypt.compare() regardless of whether the user exists, using a pre-computed dummy hash when the user is not found:

```typescript
// src/server/auth.ts:92-104
// Pre-computed dummy hash for timing-safe comparison when user not found
// Using bcrypt hash of "dummy_password_for_timing_safety"
const DUMMY_HASH = "$2a$12$LQDW7KYN5Z5kqX9Z8qZ0Z.LQDW7KYN5Z5kqX9Z8qZ0ZLQDW7KYN5Z";

// Always run bcrypt.compare to prevent timing oracle
// Use dummy hash if user not found
const hashToCompare = user?.hashedPassword ?? DUMMY_HASH;
const isValid = await bcrypt.compare(password, hashToCompare);

// Return user only if found AND password is valid
if (!user || !isValid) {
  throw new Error("Invalid email or password");
}
```

This ensures:
1. bcrypt.compare() always executes (≈250ms on cost 12)
2. Attacker cannot distinguish "user not found" from "wrong password" by measuring response time
3. Generic error message reveals no information about which check failed

### Password Reset Request

The requestReset endpoint enforces a minimum 200ms response time regardless of email existence:

```typescript
// src/server/trpc/routers/auth.ts:155-233
requestReset: publicProcedure.input(resetRequestSchema).mutation(async ({ input, ctx }) => {
  const startTime = Date.now();

  // ... rate limit check ...

  const { email } = input;

  // Look up user by email
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  // If user exists, create reset token and send email
  if (user) {
    // ... token generation ...
    // Fire-and-forget email send (NEVER await)
    sendPasswordResetEmail(user.email, resetUrl);
  }

  // Enforce minimum 200ms response time to prevent timing oracle
  const elapsed = Date.now() - startTime;
  if (elapsed < 200) {
    await sleep(200 - elapsed);
  }

  // Always return generic success message (same response regardless of email existence)
  return {
    message:
      "If an account exists with that email, you will receive a password reset link shortly.",
  };
});
```

Key timing-safety measures:
1. **Fire-and-forget email** (line 219): `sendPasswordResetEmail()` is NOT awaited, so network latency doesn't leak into response time
2. **200ms floor** (lines 222-226): If database lookup + token creation takes <200ms, sleep to pad response time
3. **Generic response** (lines 229-232): Same message whether email exists or not

### Sleep Helper

```typescript
// src/server/trpc/routers/auth.ts:14-17
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

## Invariants

1. **Login ALWAYS runs bcrypt.compare** — even when user doesn't exist (line 99 in auth.ts)
2. **Dummy hash has same cost factor (12) as real hashes** — ensures comparable CPU time
3. **Reset endpoint NEVER awaits email send** — network timing leak eliminated (line 219 in auth.ts)
4. **Reset endpoint enforces 200ms minimum** — prevents database timing from leaking email existence
5. **Generic error messages for all auth failures** — "Invalid email or password" (line 74, 103 in auth.ts) and "If an account exists..." (line 231 in auth.ts)
6. **Password reset token uses 32 random bytes** (line 201 in auth.ts) — 256-bit entropy, not guessable via brute-force
7. **Token stored as SHA-256 hash** (line 202 in auth.ts) — database leak doesn't expose raw tokens

## Gotchas

- **200ms floor is NOT a ceiling** — if database query takes 300ms naturally, response is 300ms. The floor only pads fast responses. Attackers with DB access or slow networks may still see variation.
- **Dummy hash must be valid bcrypt** — using a random string would cause bcrypt.compare to throw, revealing "user not found" via exception timing.
- **Fire-and-forget means no delivery confirmation** — if sendPasswordResetEmail() throws, error is swallowed. Email failures are logged internally but don't affect response.
- **bcrypt cost 12 targets ≈250ms** — if bcrypt.compare becomes significantly faster (faster hardware, algorithmic improvements), the dummy hash may need re-tuning to match production hash timing.
- **sleep() is async** — must be awaited. Forgetting `await sleep(...)` makes it a no-op.
- **Timing floor applies AFTER database and token operations** — if those take unpredictable time (DB contention, slow RNG), variance may still leak. The floor is a best-effort defense, not absolute protection.
- **Rate limiting interacts with timing** — if rate limit check itself varies in time (Redis latency spikes), it could leak email existence before reaching the 200ms floor. Rate limit check is synchronous Lua script, so this is low-risk.
- **Registration does NOT use timing-safe email/username checks** (lines 77-100 in auth.ts) — returns specific "Email already in use" vs "Username already taken". This is acceptable because registration is not authentication-critical, and rate limiting mitigates enumeration.
- **Token brute-force is mitigated by SHA-256 + 1h expiry + single-use** — even without timing protection, 32-byte token space (2^256) is unguessable. Timing attacks are irrelevant for token validation.
