"use client";

import { useEffect } from "react";

/**
 * Root error boundary.
 *
 * Catches unhandled errors in the app tree and displays
 * a polished error state with retry capability.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="fade-in w-full max-w-md text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--color-danger)/.1)]">
          <svg
            className="h-8 w-8 text-[rgb(var(--color-danger))]"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-label="Error"
          >
            <title>Error</title>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        {/* Message */}
        <h1 className="mb-2 text-xl font-bold text-[rgb(var(--color-text-primary))]">
          Something went wrong
        </h1>
        <p className="mb-8 text-[rgb(var(--color-text-secondary))]">
          An unexpected error occurred. Try refreshing the page or click below to retry.
        </p>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-full bg-[rgb(var(--color-brand))] px-6 text-sm font-bold text-white transition-colors hover:bg-[rgb(var(--color-brand-hover))] active:bg-[rgb(var(--color-brand-active))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-brand))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--color-bg-primary))]"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-full border border-[rgb(var(--color-border-secondary))] px-6 text-sm font-bold text-[rgb(var(--color-text-primary))] transition-colors hover:bg-[rgb(var(--color-bg-secondary))]"
          >
            Go home
          </a>
        </div>

        {/* Error digest (dev only) */}
        {error.digest && (
          <p className="mt-6 text-xs text-[rgb(var(--color-text-tertiary))]">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
