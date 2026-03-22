"use client";

import { getTRPCClient, trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

/**
 * Root providers — wraps the entire application.
 *
 * Layering order (outermost → innermost):
 * 1. ThemeProvider — dark/light mode via next-themes
 * 2. SessionProvider — NextAuth session context
 * 3. tRPC + React Query — data fetching layer
 *
 * QueryClient configured with sensible defaults:
 * - staleTime: 30s (data considered fresh, no refetch)
 * - gcTime: 5m (garbage collect unused cache entries)
 * - retry: 1 (single retry on failure)
 * - refetchOnWindowFocus: false (prevent jarring refetches)
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  const [trpcClient] = useState(() => getTRPCClient());

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </trpc.Provider>
      </SessionProvider>
    </ThemeProvider>
  );
}
