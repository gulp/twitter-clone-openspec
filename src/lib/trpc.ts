import type { AppRouter } from "@/server/trpc/router";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";

/**
 * tRPC React client setup.
 *
 * Creates type-safe React hooks for calling tRPC procedures.
 * Used with QueryClientProvider in the app layout.
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * tRPC client configuration.
 *
 * Uses httpBatchLink to batch multiple requests into a single HTTP call.
 * superjson transformer handles Date, Map, Set serialization.
 */
export function getTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
      }),
    ],
  });
}
