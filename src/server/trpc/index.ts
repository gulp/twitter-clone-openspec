import { randomUUID } from "node:crypto";
import { TRPCError, initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getServerSession } from "next-auth";
import superjson from "superjson";
import { authOptions } from "../auth";

/**
 * tRPC context — available to all procedures.
 *
 * Contains:
 * - session: NextAuth session (null if not authenticated)
 * - requestId: UUIDv4 for request tracing
 */
export async function createTRPCContext(_opts: FetchCreateContextFnOptions) {
  const session = await getServerSession(authOptions);
  const requestId = randomUUID();

  return {
    session,
    requestId,
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
 * publicProcedure — accessible without authentication.
 *
 * NOTE: Rate limiting middleware will be added in Phase B (tw-1er.1).
 * For now, this is a plain base procedure.
 */
export const publicProcedure = t.procedure;

/**
 * protectedProcedure — requires authentication.
 *
 * Extends publicProcedure with session check.
 * Throws UNAUTHORIZED if no session.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
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
