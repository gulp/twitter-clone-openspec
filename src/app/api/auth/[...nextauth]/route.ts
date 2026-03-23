import { authOptions } from "@/server/auth";
import { checkAuthIPRateLimit } from "@/server/services/rate-limiter";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import NextAuth from "next-auth";

/**
 * NextAuth API route handler.
 *
 * This exports GET and POST handlers for all NextAuth endpoints:
 * - /api/auth/signin
 * - /api/auth/signout
 * - /api/auth/callback/*
 * - /api/auth/session
 * - /api/auth/providers
 * - /api/auth/csrf
 */
const handler = NextAuth(authOptions);

/**
 * Get client IP address from request headers.
 * Used for IP-based rate limiting.
 */
function getClientIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Wrapped POST handler with rate limiting for credentials login.
 *
 * NextAuth's authorize callback doesn't receive request object,
 * so we intercept POST /api/auth/callback/credentials here.
 *
 * Rate limiting: 5 requests/min per IP (fail closed).
 */
async function POST_WITH_RATE_LIMIT(req: NextRequest, context: any) {
  const url = new URL(req.url);

  // Only rate limit credentials callback (not other auth endpoints)
  if (url.pathname.includes("/callback/credentials")) {
    const ip = getClientIP(req);

    try {
      const rateLimit = await checkAuthIPRateLimit(ip);

      if (!rateLimit.allowed) {
        return new NextResponse(
          JSON.stringify({
            error: "Too many login attempts. Please try again later.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rateLimit.retryAfter || 60),
            },
          }
        );
      }
    } catch (error) {
      // Fail closed: reject on Redis failure (security-critical)
      if (error instanceof Error && error.message === "Rate limiting unavailable") {
        return new NextResponse(
          JSON.stringify({
            error: "Service temporarily unavailable. Please try again later.",
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      throw error;
    }
  }

  // Pass to NextAuth handler
  return handler(req, context);
}

export { handler as GET, POST_WITH_RATE_LIMIT as POST };
