# Authentication and Session Management

## What

Three-layer session validation: JWT signature, Redis allow-list (`session:jti:{jti}`), and database `sessionVersion` check. Prevents timing attacks on login and password reset. Uses bcrypt cost 12 for password hashing. SHA-256 hashed password reset tokens with single-use enforcement.

## Where

- `src/server/auth.ts:47-346` — NextAuth configuration
- `src/server/auth.ts:66-114` — Credentials provider with timing-safe comparison
- `src/server/auth.ts:189-232` — OAuth auto-account creation
- `src/server/auth.ts:246-292` — JWT callback with session validation
- `src/server/trpc/routers/auth.ts:51-138` — User registration
- `src/server/trpc/routers/auth.ts:155-233` — Password reset request (timing-safe)
- `src/server/trpc/routers/auth.ts:242-301` — Password reset completion
- `src/server/trpc/routers/auth.ts:309-323` — Logout all devices

## How It Works

### Session Validation (Three-Layer Check)

Every authenticated request validates the session in three steps:

```typescript
// src/server/auth.ts:265-289
if (trigger === "update" || !user) {
  // Check Redis allow-list
  const jti = token.jti as string | undefined;
  if (!jti) {
    return {}; // No jti → invalid token
  }

  const redisSession = await sessionGet(jti);

  // If Redis says session doesn't exist, fall back to DB sessionVersion check
  if (redisSession === null) {
    // Validate sessionVersion from DB
    const dbUser = await prisma.user.findUnique({
      where: { id: token.sub },
      select: { sessionVersion: true },
    });

    if (!dbUser || dbUser.sessionVersion !== token.sv) {
      return {}; // sessionVersion mismatch → session invalidated
    }
  }
}
```

1. **JWT signature:** NextAuth validates the signature (automatic)
2. **Redis allow-list:** Check if `session:jti:{jti}` exists in Redis
3. **SessionVersion:** If Redis is down (returns null), fall back to DB check that `token.sv === User.sessionVersion`

Returning `{}` from the JWT callback invalidates the session and forces re-authentication.

### Timing-Safe Login

Always runs `bcrypt.compare()` even when the user doesn't exist, using a pre-computed dummy hash to prevent timing oracles:

```typescript
// src/server/auth.ts:92-104
// Pre-computed dummy hash for timing-safe comparison when user not found
const DUMMY_HASH = "$2a$12$LQDW7KYN5Z5kqX9Z8qZ0Z.LQDW7KYN5Z5kqX9Z8qZ0ZLQDW7KYN5Z";

// Always run bcrypt.compare to prevent timing oracle
const hashToCompare = user?.hashedPassword ?? DUMMY_HASH;
const isValid = await bcrypt.compare(password, hashToCompare);

// Return user only if found AND password is valid
if (!user || !isValid) {
  throw new Error("Invalid email or password");
}
```

Both wrong email and wrong password return the same generic error message after the same bcrypt operation duration.

### Timing-Safe Password Reset Request

Enforces 200ms minimum response time and fires off email send asynchronously to prevent timing attacks that could enumerate registered emails:

```typescript
// src/server/trpc/routers/auth.ts:156, 218-232
const startTime = Date.now();

// ... user lookup, token generation, email send (NEVER await email send)

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
```

The email send is fire-and-forget (no `await`). The response is identical whether the email exists or not.

### Password Reset Token Generation

Reset tokens are 32 random bytes, hex-encoded. Only the SHA-256 hash is stored in the database:

```typescript
// src/server/trpc/routers/auth.ts:200-216
// Generate reset token (32 random bytes, hex-encoded)
const rawToken = randomBytes(32).toString("hex");
const tokenHash = createHash("sha256").update(rawToken).digest("hex");

// Store token hash in DB (1-hour expiry)
const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

await prisma.passwordResetToken.create({
  data: {
    tokenHash,
    userId: user.id,
    expiresAt,
  },
});

// Construct reset URL
const resetUrl = `${env.APP_ORIGIN}/reset-password?token=${rawToken}`;
```

Prior active tokens for the user are invalidated before creating the new one:

```typescript
// src/server/trpc/routers/auth.ts:191-198
await prisma.passwordResetToken.updateMany({
  where: {
    userId: user.id,
    used: false,
    expiresAt: { gt: new Date() },
  },
  data: { used: true },
});
```

### Password Reset Completion

Token validation checks hash, expiry, and single-use flag. Password update and session invalidation happen in a single transaction:

```typescript
// src/server/trpc/routers/auth.ts:279-296
await prisma.$transaction([
  // Update password and increment sessionVersion (invalidates all sessions)
  prisma.user.update({
    where: { id: resetToken.userId },
    data: {
      hashedPassword,
      sessionVersion: { increment: 1 },
    },
  }),

  // Mark token as used
  prisma.passwordResetToken.update({
    where: { tokenHash },
    data: { used: true },
  }),
]);
```

Incrementing `sessionVersion` invalidates all existing JWTs for the user (forces logout everywhere).

### Logout All Devices

Increments `User.sessionVersion`, which causes all existing JWTs to fail validation on their next request:

```typescript
// src/server/trpc/routers/auth.ts:309-323
logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
  const userId = ctx.session.user.id;

  await prisma.user.update({
    where: { id: userId },
    data: {
      sessionVersion: { increment: 1 },
    },
  });

  return {
    message: "Logged out from all devices successfully.",
  };
});
```

### OAuth Username Generation

OAuth users get auto-generated usernames using CUID prefix strategy (zero retries):

```typescript
// src/server/auth.ts:193-216
const { createId } = await import("@paralleldrive/cuid2");
const userId = createId();

// Derive username from OAuth display name
const displayName = user.name || "user";
const baseUsername = displayName
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "")
  .slice(0, 9);

// Append CUID prefix (first 6 chars) for uniqueness
const username = `${baseUsername}_${userId.slice(0, 6)}`;

// Create user (using the pre-generated CUID as id)
await prisma.user.create({
  data: {
    id: userId,
    email,
    username,
    displayName,
    avatarUrl: user.image || "",
    hashedPassword: null, // OAuth users have no password
  },
});
```

The CUID prefix (6 chars) provides uniqueness without retry logic. OAuth users have `hashedPassword: null`.

## Invariants

1. **I-AUTH-1:** Login MUST always run `bcrypt.compare()`, even for non-existent users (use DUMMY_HASH)
2. **I-AUTH-2:** Login wrong-email and wrong-password MUST return identical error message and timing
3. **I-AUTH-3:** Password reset request MUST enforce minimum 200ms response time
4. **I-AUTH-4:** Password reset request MUST return identical message regardless of email existence
5. **I-AUTH-5:** Email send in password reset MUST be fire-and-forget (no await)
6. **I-SESSION-1:** Session validation MUST check JWT signature AND Redis allow-list AND sessionVersion
7. **I-SESSION-2:** Redis allow-list failure MUST fall back to DB sessionVersion check (fail open)
8. **I-SESSION-3:** Incrementing sessionVersion MUST invalidate all user's JWTs immediately
9. **I-TOKEN-1:** Password reset tokens MUST be stored as SHA-256 hash, never plaintext
10. **I-TOKEN-2:** Password reset tokens MUST have 1-hour expiry and single-use enforcement
11. **I-TOKEN-3:** Creating new reset token MUST invalidate all prior active tokens for user
12. **I-OAUTH-1:** OAuth sign-in MUST reject if email is not verified
13. **I-OAUTH-2:** OAuth username MUST use CUID prefix strategy (zero retries, collision-resistant)
14. **I-HASH-1:** All passwords MUST use bcrypt cost 12

## Gotchas

**Why sessionVersion + Redis?** Redis allow-list alone can't provide instant "logout everywhere" — you'd need to enumerate all JWTs for a user. The `sessionVersion` in DB provides atomic invalidation by incrementing a single integer.

**Why Redis if we have sessionVersion?** Redis is a performance optimization to avoid a DB query on every request. On Redis failure, the system falls back to the DB check (fail-open for auth session reads, fail-closed for auth rate limiting).

**Dummy hash constant:** The `DUMMY_HASH` value is a real bcrypt hash of `"dummy_password_for_timing_safety"` with cost 12. It must be a valid hash so `bcrypt.compare()` performs the same work whether the user exists or not.

**Password reset timing window:** The 200ms floor applies to the ENTIRE mutation, including DB lookups, token generation, and Redis calls. This prevents attackers from measuring database query time differences to infer whether an email exists.

**OAuth email verification required:** Both Google and GitHub OAuth flows reject sign-ins if the provider didn't verify the email. This prevents attackers from creating accounts with arbitrary email addresses via OAuth.

**NextAuth allowDangerousEmailAccountLinking:** Set to `true` to allow users with existing credentials accounts to link OAuth providers with the same verified email. Without this, OAuth sign-in would fail if a credentials account already exists for that email.

**Transaction for password reset:** The password update and token marking must be atomic. If the password update succeeds but marking the token as used fails, the token could be reused. The transaction ensures both operations commit together or roll back together.

**hashedPassword never exposed:** The `select` statements in auth.ts never include `hashedPassword` in the returned object. It's only read for `bcrypt.compare()` and never sent to the client.
