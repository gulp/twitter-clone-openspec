import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { env } from "@/env";
import { log } from "@/lib/logger";

/**
 * Next.js middleware for security headers and CSRF protection.
 * Per §1.17 and §1.20.
 */

export function middleware(request: NextRequest) {
  const requestId = randomUUID();
  const nonce = randomUUID();

  // CSRF Origin Validation (§1.20)
  // For POST requests to /api/trpc and /api/auth, validate Origin header
  if (request.method === "POST") {
    const pathname = request.nextUrl.pathname;
    if (pathname.startsWith("/api/trpc") || pathname.startsWith("/api/auth")) {
      const origin = request.headers.get("origin");
      const allowedOrigins = getAllowedOrigins();

      // Reject if no origin header or origin doesn't match allowed list
      if (!origin || !allowedOrigins.includes(origin)) {
        log.warn("CSRF origin validation failed", {
          requestId,
          origin: origin ?? "(missing)",
          route: pathname,
          method: request.method,
        });

        return new NextResponse("Forbidden", { status: 403 });
      }
    }
  }

  // Content Security Policy with nonce (§1.17)
  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.amazonaws.com https://*.minio.*",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Nonce", nonce);

  return response;
}

/**
 * Get list of allowed origins for CSRF validation.
 * Includes APP_ORIGIN and any preview origins from environment.
 */
function getAllowedOrigins(): string[] {
  const origins = [env.APP_ORIGIN];

  if (env.ALLOWED_PREVIEW_ORIGINS) {
    const previewOrigins = env.ALLOWED_PREVIEW_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    origins.push(...previewOrigins);
  }

  return origins;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
