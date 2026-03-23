import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js middleware for security headers and CSRF protection.
 * Per §1.17 and §1.20.
 *
 * Runs in Edge Runtime — no Node.js imports (crypto module, fs, etc.).
 * Uses process.env directly (not src/env.ts which calls process.exit at import).
 */

export function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  // CSRF Origin Validation (§1.20)
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

  // Content Security Policy with nonce (§1.17)
  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://*.amazonaws.com ${process.env.S3_ENDPOINT ?? ""}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  // Pass nonce to pages via request header (not response header — that leaks it to JS)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Request-Id", requestId);

  return response;
}

/**
 * Get list of allowed origins for CSRF validation.
 * Uses process.env directly (Edge Runtime compatible).
 */
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
