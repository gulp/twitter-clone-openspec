import { randomUUID } from "node:crypto";
import { TRPCError, initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getServerSession } from "next-auth";
import superjson from "superjson";
import { log } from "@/lib/logger";
import { authOptions } from "../auth";
import { requestContext } from "../db";

/**
 * tRPC context — available to all procedures.
 *
 * Contains:
 * - session: NextAuth session (null if not authenticated)
 * - requestId: UUIDv4 for request tracing
 * - req: Request object (for accessing headers, IP, etc.)
 */
export async function createTRPCContext(opts: FetchCreateContextFnOptions) {
  const session = await getServerSession(authOptions);
  const requestId = randomUUID();

  return {
    session,
    requestId,
    req: opts.req,
  };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

/**
 * Initialize tRPC with superjson transformer.
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

/**
 * Base tRPC router and procedure builder.
 */
export const createTRPCRouter = t.router;

/**
 * Logging middleware — logs every tRPC response with structured data.
 *
 * Logs:
 * - requestId, route, userId, latencyMs for all responses
 * - Error responses at WARN/ERROR level with errorCode
 * - Auth failures at WARN with IP address
 * - Rate limit hits at WARN with IP and userId
 * - Slow queries (>500ms) at WARN
 */
const loggingMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const startMs = Date.now();

  // Extract IP address from request headers
  const ip =
    ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    ctx.req.headers.get("x-real-ip") ||
    "unknown";

  try {
    const result = await next();
    const latencyMs = Date.now() - startMs;

    // Base log fields
    const logData = {
      requestId: ctx.requestId,
      route: `${type}.${path}`,
      userId: ctx.session?.user?.id,
      latencyMs,
      statusCode: 200,
    };

    // Warn on slow queries
    if (latencyMs > 500) {
      log.warn("Slow tRPC query", logData);
    } else {
      log.info("tRPC response", logData);
    }

    return result;
  } catch (error) {
    const latencyMs = Date.now() - startMs;

    // Handle TRPCError instances
    if (error instanceof TRPCError) {
      const logData = {
        requestId: ctx.requestId,
        route: `${type}.${path}`,
        userId: ctx.session?.user?.id,
        latencyMs,
        errorCode: error.code,
        ip,
      };

      // Auth failures and rate limits at WARN
      if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
        log.warn("Auth failure", logData);
      } else if (error.code === "TOO_MANY_REQUESTS") {
        log.warn("Rate limit hit", logData);
      } else if (
        error.code === "INTERNAL_SERVER_ERROR" ||
        error.code === "TIMEOUT"
      ) {
        log.error("tRPC error", { ...logData, message: error.message });
      } else {
        log.warn("tRPC error", logData);
      }
    } else {
      // Non-tRPC errors
      log.error("Unexpected error", {
        requestId: ctx.requestId,
        route: `${type}.${path}`,
        userId: ctx.session?.user?.id,
        latencyMs,
        errorCode: "UNKNOWN",
        ip,
      });
    }

    throw error;
  }
});

/**
 * publicProcedure — accessible without authentication.
 *
 * Includes logging middleware.
 * NOTE: Rate limiting middleware will be added in Phase B (tw-1er.1).
 */
export const publicProcedure = t.procedure.use(loggingMiddleware);

/**
 * protectedProcedure — requires authentication.
 *
 * Includes logging middleware and session check.
 * Throws UNAUTHORIZED if no session.
 */
export const protectedProcedure = t.procedure
  .use(loggingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        ...ctx,
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });
