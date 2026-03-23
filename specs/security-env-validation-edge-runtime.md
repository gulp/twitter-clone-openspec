# Environment Validation in Edge Runtime

## What

Edge Runtime middleware cannot use Node.js-specific validation (like `process.exit()` in Zod schemas). This creates a validation gap where missing `APP_ORIGIN` causes silent failures in CSRF protection.

The application uses two environment access patterns:
- **Server-side** (tRPC, services): validated `env` object with Zod schema
- **Edge Runtime** (middleware): direct `process.env` access with no validation

## Where

**Edge Runtime constraint:**
- `src/middleware.ts:8-9` — Cannot import Node.js modules (crypto, fs) or code that calls `process.exit()`
- `src/middleware.ts:71` — Uses `process.env.APP_ORIGIN` directly

**Server-side validation:**
- `src/env.ts:29` — `APP_ORIGIN: z.string().url()` schema
- `src/env.ts:97-102` — Proxy-based lazy validation on first property access

**CSRF validation with fallback:**
- `src/middleware.ts:70-86` — `getAllowedOrigins()` returns `[]` if `APP_ORIGIN` is undefined
- `src/middleware.ts:23` — `!allowedOrigins.includes(origin)` always true when array is empty

## How It Works

### Validation Split

```typescript
// src/env.ts — Server-side only (calls process.exit)
const envSchema = z.object({
  APP_ORIGIN: z.string().url("APP_ORIGIN must be a valid URL"),
  // ... other vars
});

export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop) {
    const validated = getValidatedEnv(); // Throws on first access if invalid
    return validated[prop as keyof typeof validated];
  },
});
```

```typescript
// src/middleware.ts:70-86 — Edge Runtime (no validation)
function getAllowedOrigins(): string[] {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) return []; // Silent fallback

  const origins = [appOrigin];
  // ... preview origins handling
  return origins;
}
```

### Fail-Closed Behavior

When `APP_ORIGIN` is missing:
1. `getAllowedOrigins()` returns `[]`
2. CSRF check at line 23: `!allowedOrigins.includes(origin)` → always `true`
3. All POST requests to `/api/trpc` and `/api/auth` → 403 Forbidden
4. Warning logged: `"CSRF origin validation failed"` with `origin: "(missing)"` or actual origin
5. No indication that root cause is missing `APP_ORIGIN` env var

### Why This Pattern Exists

Edge Runtime restrictions:
- Cannot call `process.exit()` → can't use standard Zod validation
- Cannot import Node.js modules → can't share `env.ts` validation
- Needs to be fail-closed for security → empty allowlist rejects all origins

Lazy validation in `env.ts`:
- Allows `next build` to succeed without full `.env` file
- Defers validation until first server-side code accesses `env` object
- Middleware runs before server-side code → validation never triggers for Edge-only deploys

## Invariants

**I1:** Middleware MUST NOT import `src/env.ts` or any module that calls `process.exit()` at import time.

**I2:** Missing `APP_ORIGIN` MUST fail-closed (reject all cross-origin POST requests).

**I3:** CSRF validation failures MUST be logged with structured JSON including `origin`, `route`, `requestId`.

**I4:** `getAllowedOrigins()` MUST return `[]` when `APP_ORIGIN` is undefined (not throw, not use default value).

**I5:** Server-side code (tRPC routers, services) MUST use `env` object, not `process.env`, to trigger validation.

## Gotchas

### Silent Misconfiguration

**Problem:** Application starts successfully but rejects all POST requests.

**Root cause:** `APP_ORIGIN` env var missing or malformed.

**Detection:** CSRF warnings in logs show `origin: "(missing)"` but don't mention `APP_ORIGIN`.

**Mitigation:**
- Run `npm run dev` or `npm start` triggers server-side code that accesses `env` object
- First request to tRPC endpoint validates all env vars (fails fast with clear error)
- For Edge-only deploys: add explicit healthcheck that imports `env`

### Preview Deployments

**Problem:** `ALLOWED_PREVIEW_ORIGINS` is optional but not validated in middleware.

**Behavior:**
- Missing → ignored (only `APP_ORIGIN` used)
- Malformed (e.g., trailing comma) → empty strings filtered out at line 81
- Invalid URLs → no validation, passed to `includes()` check

**Mitigation:** Preview origins are comma-separated strings, not validated as URLs. Typos cause silent rejection. Check logs for `origin: "https://preview.example.com"` mismatches.

### Edge Function Deploys

**Problem:** Vercel/Netlify Edge Functions may never execute server-side code.

**Scenario:**
1. Deploy with only middleware + SSR pages (no tRPC calls on first load)
2. `env` object never accessed → validation never runs
3. Application appears healthy but all POST requests fail

**Mitigation:** Add health check endpoint that imports and accesses `env.APP_ORIGIN`.

### CSP Header S3_ENDPOINT Fallback

**Similar pattern at line 45:**
```typescript
`img-src 'self' data: blob: https://*.amazonaws.com ${process.env.S3_ENDPOINT ?? ""}`.trim()
```

Missing `S3_ENDPOINT` → CSP header ends with trailing space → valid but not ideal.

Unlike `APP_ORIGIN`, missing `S3_ENDPOINT` doesn't break functionality (AWS S3 wildcard covers it). But media from custom MinIO endpoints will be blocked.

## Testing

### Verify Fail-Closed Behavior

```bash
# Remove APP_ORIGIN from .env
unset APP_ORIGIN

# Start server
npm run dev

# Attempt POST request
curl -X POST http://localhost:3000/api/trpc/auth.register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@example.com","password":"password123"}'

# Expected: 403 Forbidden
# Expected log: {"level":"warn","msg":"CSRF origin validation failed","origin":"(missing)",...}
```

### Verify Server-Side Validation Triggers

```bash
# Remove DATABASE_URL from .env
unset DATABASE_URL

# Start server (will fail on first env access)
npm run dev

# Expected: Process exits with error:
# ❌ Environment validation failed:
#   - DATABASE_URL: DATABASE_URL is required
```

### Verify Allowed Origin Accepts Request

```bash
# Set APP_ORIGIN
export APP_ORIGIN=http://localhost:3000

# POST with matching origin
curl -X POST http://localhost:3000/api/trpc/auth.register \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@example.com","password":"password123"}'

# Expected: Request processed (may fail on business logic, but not CSRF)
```

## Related Specs

- `security-csrf-origin.md` — CSRF validation logic
- `security-session-management.md` — Session validation that uses `env` object
- `logging-request-correlation.md` — Request ID propagation (same middleware)
