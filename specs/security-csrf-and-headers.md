# CSRF Protection and Security Headers

## What

CSRF (Cross-Site Request Forgery) protection via Origin header validation and Content Security Policy (CSP) with per-request nonces. Implemented in Next.js middleware to protect all mutation endpoints.

## Where

- `src/middleware.ts:12-64` — Edge middleware with CSRF and CSP
- `src/middleware.ts:16-38` — Origin validation for POST requests
- `src/middleware.ts:40-64` — CSP header generation with nonce
- `src/middleware.ts:66-86` — Allowed origins configuration

## How It Works

### CSRF Origin Validation

All POST requests to `/api/trpc` and `/api/auth` require a valid `Origin` header that matches `APP_ORIGIN` or entries in `ALLOWED_PREVIEW_ORIGINS`.

```typescript
// src/middleware.ts:16-38
if (request.method === "POST") {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/trpc") || pathname.startsWith("/api/auth")) {
    const origin = request.headers.get("origin");
    const allowedOrigins = getAllowedOrigins();

    if (!origin || !allowedOrigins.includes(origin)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "CSRF origin validation failed",
          requestId,
          origin: origin ?? "(missing)",
          route: pathname,
          ts: new Date().toISOString(),
        })
      );
      return new NextResponse("Forbidden", { status: 403 });
    }
  }
}
```

Requests without a matching origin receive `403 Forbidden`. The validation is logged with structured JSON including `requestId` and `origin`.

### Content Security Policy with Nonce

CSP is generated per-request in middleware with a cryptographically random nonce. The nonce is passed to the page via `x-nonce` request header (not response header, to prevent JS access).

```typescript
// src/middleware.ts:13-14, 40-49
const nonce = crypto.randomUUID();

const cspHeader = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.amazonaws.com https://*.minio.*",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
```

The nonce changes on every request. Scripts must use `<script nonce={nonce}>` to execute.

### Request ID Propagation

Every request receives a unique `x-request-id` header for correlation across logs and error messages.

```typescript
// src/middleware.ts:13, 54, 61
const requestId = crypto.randomUUID();
requestHeaders.set("x-request-id", requestId);
response.headers.set("X-Request-Id", requestId);
```

## Invariants

1. **I-CSRF-1:** All POST requests to `/api/trpc` or `/api/auth` MUST have a valid Origin header
2. **I-CSRF-2:** Origin validation failures MUST return 403 Forbidden with structured log
3. **I-CSP-1:** CSP nonce MUST be generated per-request, never reused across requests
4. **I-CSP-2:** CSP nonce is passed via request header `x-nonce`, never exposed in response headers
5. **I-REQ-1:** Every request receives a unique `x-request-id` for log correlation

## Gotchas

**Edge Runtime constraints:** `middleware.ts` runs in Next.js Edge Runtime, which has no access to Node.js APIs like `fs`, `crypto.randomBytes`, or `process.exit()`. It uses the Web Crypto API (`crypto.randomUUID()`) and reads environment variables directly via `process.env` instead of importing `src/env.ts` (which calls `process.exit()` on validation failure).

**Image sources:** CSP allows images from S3 (`https://*.amazonaws.com`) and MinIO (`https://*.minio.*`) for user-uploaded avatars, banners, and tweet media.

**Style inline allowed:** CSP includes `'unsafe-inline'` for `style-src` because Tailwind CSS uses inline styles. This is an acceptable trade-off since XSS protection relies primarily on `script-src` nonces.

**Matcher scope:** The middleware matcher `/((?!_next/static|_next/image|favicon.ico).*)` excludes static assets but applies to all other routes, including page navigations. CSRF validation only triggers on POST requests to API routes.

**Preview origins:** `ALLOWED_PREVIEW_ORIGINS` supports comma-separated list for Vercel preview deployments or staging environments. Empty entries are filtered out during parsing.
