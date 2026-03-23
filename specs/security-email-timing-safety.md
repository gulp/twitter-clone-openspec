# Fire-and-Forget Email Pattern for Timing Attack Prevention

## What

Email sending uses a fire-and-forget pattern where `sendPasswordResetEmail()` returns immediately without awaiting the async SMTP operation. This prevents attackers from distinguishing "user exists but email failed" from "user doesn't exist" via response timing analysis, closing a critical information disclosure vector.

## Where

- `src/server/services/email.ts:94-127` — `sendPasswordResetEmail()` wraps async operation in `void (async () => { ... })()` IIFE
- `src/server/trpc/routers/auth.ts:219` — `requestReset` calls without `await`
- `src/server/trpc/routers/auth.ts:222-226` — Enforces 200ms minimum response time to mask database lookup timing

## How It Works

### Fire-and-Forget Implementation

```typescript
// src/server/services/email.ts:94-127
export function sendPasswordResetEmail(to: string, resetUrl: string): void {
  // Fire-and-forget: do not await
  void (async () => {
    try {
      const transport = await getTransporter();
      const info = await transport.sendMail({ /* ... */ });
      log.info("Password reset email sent", { to, messageId: info.messageId });
    } catch (error) {
      // Log error but do not throw — email sending is best-effort
      log.error("Failed to send password reset email", { to, error });
    }
  })();
}
```

**Key mechanics:**
1. Function signature returns `void`, not `Promise<void>`
2. IIFE `(async () => { ... })()` creates detached async context
3. `void` operator discards returned promise (ESLint @typescript-eslint/no-floating-promises compliance)
4. All errors caught internally — caller never sees email failures
5. Logs success/failure for operational visibility

### Timing-Safe Request Flow

```typescript
// src/server/trpc/routers/auth.ts:177-226
requestReset: publicProcedure.input(z.object({ email: z.string().email() })).mutation(async ({ input, ctx }) => {
  const startTime = Date.now();

  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (user) {
    // Invalidate old tokens, create new token, send email
    // ...
    sendPasswordResetEmail(user.email, resetUrl);  // NO await
  }

  // Enforce 200ms minimum response — masks DB timing differences
  const elapsed = Date.now() - startTime;
  if (elapsed < 200) {
    await sleep(200 - elapsed);
  }

  return { success: true };  // ALWAYS returns success (no info leak)
});
```

**Timing attack surface eliminated:**

| Scenario | Without Fire-and-Forget | With Fire-and-Forget |
|----------|------------------------|---------------------|
| User exists, email succeeds | ~400ms (DB + SMTP) | 200ms (min enforced) |
| User exists, email fails | ~300ms (DB + SMTP timeout) | 200ms (error logged async) |
| User doesn't exist | ~50ms (fast DB miss) | 200ms (min enforced) |

Attacker cannot distinguish valid vs invalid emails by measuring response time.

## Invariants

1. **Never await email sends in security-critical flows** — `sendPasswordResetEmail()` must be called without `await` to prevent timing oracle
2. **All email errors caught internally** — caller receives no indication of SMTP failure (best-effort delivery)
3. **Minimum response time enforced** — `requestReset` must enforce ≥200ms response time regardless of code path
4. **Always return success** — `requestReset` returns `{ success: true }` even if user not found (no enumeration)
5. **Errors logged, never thrown** — Email service logs failures with structured context but never throws exceptions

## Gotchas

### ❌ DON'T: Await email sends in timing-sensitive flows

```typescript
// WRONG: Email send duration leaks user existence
if (user) {
  await sendPasswordResetEmail(user.email, resetUrl);  // ← LEAK
}
return { success: true };  // Returns fast if user missing
```

Attacker measures response time:
- Valid email: ~350ms (includes SMTP round-trip)
- Invalid email: ~50ms (no SMTP)
- **User enumeration vulnerability**

### ✅ DO: Fire-and-forget with minimum response time

```typescript
// CORRECT: Timing masked by fire-and-forget + sleep
if (user) {
  sendPasswordResetEmail(user.email, resetUrl);  // No await
}

const elapsed = Date.now() - startTime;
if (elapsed < 200) {
  await sleep(200 - elapsed);
}
return { success: true };  // Always 200ms regardless of path
```

### ❌ DON'T: Return early on email errors

```typescript
// WRONG: Error handling creates timing oracle
try {
  await sendPasswordResetEmail(user.email, resetUrl);
  return { success: true };
} catch (error) {
  return { success: false, error: "Email failed" };  // ← LEAK
}
```

Reveals email sending outcome (SMTP server health, recipient validity).

### ✅ DO: Catch all errors internally

```typescript
// CORRECT: Errors caught in async IIFE, logged but hidden from caller
void (async () => {
  try {
    await transport.sendMail({ /* ... */ });
    log.info("Email sent");
  } catch (error) {
    log.error("Email failed", { error });  // Logged for ops, hidden from user
  }
})();
```

### Development Mode: Ethereal Test Accounts

Email service auto-creates Ethereal.email test account in development when `SMTP_HOST` is not configured:

```typescript
// src/server/services/email.ts:51-83
const testAccount = await nodemailer.createTestAccount();
transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  auth: { user: testAccount.user, pass: testAccount.pass },
});
```

Preview URLs logged to console: `https://ethereal.email/messages`

**Gotcha:** First email in dev mode may exceed 200ms due to Ethereal account creation. Not a security issue (timing oracle only matters in production with real user data).

### void Operator Necessity

```typescript
// ESLint @typescript-eslint/no-floating-promises requires explicit discard
void (async () => { /* ... */ })();  // ✅ Explicit discard
(async () => { /* ... */ })();       // ❌ ESLint error
```

The `void` operator signals intentional fire-and-forget to linters.

## Related Specs

- `security-timing-attacks.md` — Constant-time comparison, dummy bcrypt hash, minimum response times
- `security-auth-and-sessions.md` — Password reset token lifecycle, hash storage
- `logging-structured-output-redaction.md` — Email address logging (not redacted, vs password/token)
