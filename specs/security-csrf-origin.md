# CSRF Protection via Origin Validation

## What

All cookie-authenticated mutations enforce explicit Origin header validation to prevent Cross-Site Request Forgery (CSRF) attacks. Requests to `/api/trpc` and `/api/auth` with unsafe methods (POST) must include a valid Origin header matching the allowed list.

## Where

- `src/middleware.ts:12-38` — Origin validation logic in Next.js Edge middleware
- `src/middleware.ts:70-86` — getAllowedOrigins() reads APP_ORIGIN and ALLOWED_PREVIEW_ORIGINS

## How It Works

The Next.js middleware intercepts all POST requests before they reach tRPC or NextAuth handlers:

```typescript
// src/middleware.ts:17-38
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

Allowed origins are derived from environment variables:

```typescript
// src/middleware.ts:70-86
function getAllowedOrigins(): string[] {
  const appOrigin = process.env.APP_ORIGIN;
  if (!appOrigin) return [];

  const origins = [appOrigin];

  const previewOrigins = process.env.ALLOWED_PREVIEW_ORIGINS;
  if (previewOrigins) {
    const parsed = previewOrigins
      .split(",")
      .map((o: string) => o.trim())
      .filter((o: string) => o.length > 0);
    origins.push(...parsed);
  }

  return origins;
}
```

## Invariants

1. **All POST requests to `/api/trpc` and `/api/auth` must have a valid Origin header**
2. **Missing Origin header is treated as CSRF attempt** (403 response, not allowed to proceed)
3. **Origin validation happens in Edge middleware** (before tRPC context creation, before route handlers)
4. **APP_ORIGIN is mandatory** — if undefined, allowed list is empty and all requests fail
5. **Middleware uses process.env directly** (not src/env.ts) because Edge Runtime cannot import Node.js modules

## Gotchas

- **Same-origin requests from the browser automatically include the Origin header**, but manual fetch() calls (like from tests) may omit it unless explicitly set.
- **ALLOWED_PREVIEW_ORIGINS is comma-separated** — whitespace is trimmed but empty strings are filtered out. If you set `ALLOWED_PREVIEW_ORIGINS=""`, no extra origins are added (safe default).
- **NextAuth endpoints also protected** — `/api/auth/[...nextauth]` requires Origin validation, so OAuth callbacks must come from allowed origins.
- **GET requests bypass Origin check** — safe because GET should never mutate state. If a mutation is accidentally exposed as GET, CSRF protection will not apply.
- **Middleware runs in Edge Runtime** — cannot use Node.js `crypto`, `fs`, or `process.exit()`. Use Web Crypto API (`crypto.randomUUID()`) instead.
- **Rejections are logged as JSON to stdout** — structured logs include requestId, route, origin for incident response. No sensitive data (like cookies or tokens) is logged.
