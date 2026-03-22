# Session Management with JWT + Redis + SessionVersion

## What

Three-layer session validation combines JWT signature verification, Redis allow-list checking, and database sessionVersion matching. Enables both single-session logout (via Redis jti removal) and logout-everywhere (via sessionVersion increment). Sessions degrade gracefully on Redis failure by falling back to database checks.

## Where

- `src/server/auth.ts:47-52` — NextAuth JWT strategy configuration
- `src/server/auth.ts:246-292` — JWT callback: session creation and validation
- `src/server/auth.ts:340-344` — signOut event: Redis jti removal
- `src/server/auth.ts:309-318` — logoutAll procedure: sessionVersion increment
- `src/server/redis.ts:186-233` — Session allow-list wrappers (get/set/del)

## How It Works

### Session Creation (Sign-In)

On successful authentication, NextAuth's JWT callback creates a session token with three key claims:

```typescript
// src/server/auth.ts:248-262
if (user) {
  token.sub = user.id;
  token.jti = randomUUID();

  // Fetch sessionVersion from DB
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { sessionVersion: true },
  });

  token.sv = dbUser?.sessionVersion ?? 0;

  // Add session to Redis allow-list (30 days TTL)
  await sessionSet(token.jti, token.sub as string, 30 * 24 * 60 * 60);
}
```

### Session Validation (On Every Request)

The JWT callback runs on token refresh and validates the session:

```typescript
// src/server/auth.ts:265-289
if (trigger === "update" || !user) {
  // Check Redis allow-list
  const jti = token.jti as string | undefined;
  if (!jti) {
    // No jti → invalid token
    return {};
  }

  const redisSession = await sessionGet(jti);

  // If Redis says session doesn't exist, fall back to DB sessionVersion check
  // (Redis failure policy: fail open, fall back to DB)
  if (redisSession === null) {
    // Validate sessionVersion from DB
    const dbUser = await prisma.user.findUnique({
      where: { id: token.sub },
      select: { sessionVersion: true },
    });

    if (!dbUser || dbUser.sessionVersion !== token.sv) {
      // sessionVersion mismatch → session invalidated
      return {};
    }
  }
}
```

### Single-Session Logout

NextAuth's signOut event removes the jti from Redis:

```typescript
// src/server/auth.ts:340-344
async signOut({ token }) {
  if (token?.jti) {
    await sessionDel(token.jti as string);
  }
}
```

### Logout Everywhere

The logoutAll procedure increments User.sessionVersion, invalidating all existing JWTs:

```typescript
// src/server/auth.ts:309-318
logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
  const userId = ctx.session.user.id;

  // Increment sessionVersion to invalidate all JWTs
  await prisma.user.update({
    where: { id: userId },
    data: {
      sessionVersion: { increment: 1 },
    },
  });

  return {
    message: "Logged out from all devices successfully.",
  };
}),
```

### Redis Failure Fallback

Session operations fail open with DB fallback:

```typescript
// src/server/redis.ts:186-198
export async function sessionGet(jti: string, requestId?: string): Promise<string | null> {
  try {
    return await redis.get(`session:jti:${jti}`);
  } catch (error) {
    log.warn("Redis operation failed", {
      feature: "auth",
      operation: "sessionGet",
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return null;
  }
}
```

## Invariants

1. **Every session has three validation layers: JWT signature, Redis jti, DB sessionVersion**
2. **JWT sub claim always equals user.id** (set on line 249 of auth.ts)
3. **JWT jti claim is a UUIDv4** (set on line 250 of auth.ts via randomUUID())
4. **JWT sv claim matches User.sessionVersion** (validated on line 284 of auth.ts)
5. **Redis sessionGet returns null on failure** — never throws, triggers DB fallback
6. **Redis sessionSet/sessionDel are no-ops on failure** — warnings logged, session still works via DB
7. **Returning empty object `{}` from JWT callback invalidates session** (lines 270, 286)
8. **sessionVersion starts at 0** (Prisma schema default) and increments on password reset and logoutAll
9. **Session TTL is 30 days** (line 51 in auth.ts, line 261 in sessionSet call)

## Gotchas

- **sessionVersion increment happens in two places**: password reset (src/server/trpc/routers/auth.ts:287) and logoutAll (src/server/trpc/routers/auth.ts:313). Both must increment, not set to a fixed value.
- **Redis failure during sign-in is non-fatal** — sessionSet fails open (line 204-216 in redis.ts), user gets signed in, session validates via DB sessionVersion only.
- **JWT callback runs on EVERY request**, not just sign-in. The `trigger === "update"` check (line 265) distinguishes token refresh from initial creation.
- **Empty jti means invalid session** — line 268 returns `{}` if jti is missing. This should never happen in normal flows but protects against manually crafted JWTs.
- **sessionVersion mismatch terminates session silently** — no error thrown, just empty object return. Client sees 401 UNAUTHORIZED from protectedProcedure middleware.
- **Redis null vs undefined**: sessionGet returns `null` on both "key doesn't exist" and "Redis error". The DB fallback (line 277-287) triggers for both cases.
- **Token rotation**: NextAuth doesn't rotate JWTs by default. Same jti persists for the entire session lifetime unless explicitly signed out.
- **HttpOnly cookies**: Session token is stored in HttpOnly cookie (line 329), inaccessible to JavaScript, preventing XSS token theft.
- **SameSite=lax**: Cookie setting (line 330) allows GET-based navigation but blocks cross-site POST, complementing Origin validation.
