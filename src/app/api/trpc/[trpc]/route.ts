import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc";

/**
 * tRPC HTTP handler for Next.js App Router.
 *
 * Handles all tRPC requests at /api/trpc/*
 */
const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  });

export { handler as GET, handler as POST };
