import Link from "next/link";

/**
 * 404 page — clean, on-brand, with a clear path home.
 *
 * Server Component (no "use client" needed).
 * Uses the X visual language — minimal, bold, confident.
 */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="fade-in w-full max-w-md text-center">
        {/* Large brand-colored 404 */}
        <div className="mb-6">
          <span className="text-8xl font-black tracking-tight text-[rgb(var(--color-brand)/.15)]">
            404
          </span>
        </div>

        {/* Message */}
        <h1 className="mb-2 text-xl font-bold text-[rgb(var(--color-text-primary))]">
          Hmm...this page doesn&apos;t exist
        </h1>
        <p className="mb-8 text-[rgb(var(--color-text-secondary))]">
          The link you followed may be broken, or the page may have been removed.
        </p>

        {/* Action */}
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-full bg-[rgb(var(--color-brand))] px-6 text-sm font-bold text-white transition-colors hover:bg-[rgb(var(--color-brand-hover))] active:bg-[rgb(var(--color-brand-active))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-brand))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--color-bg-primary))]"
        >
          Go to home
        </Link>
      </div>
    </div>
  );
}
