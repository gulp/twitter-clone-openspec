import { cn } from "@/lib/utils";

/**
 * Loading skeleton components
 *
 * Sophisticated multi-layer shimmer animations for:
 * - Tweet cards
 * - Profile headers
 * - User lists
 *
 * Uses CSS animation from globals.css (.skeleton-shimmer)
 */

/**
 * Tweet card skeleton — for feed loading states
 */
export function TweetSkeleton({ count = 1 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="border-b border-[rgb(var(--color-border-primary))] px-4 py-3"
        >
          <div className="flex gap-3">
            {/* Avatar */}
            <div className="h-12 w-12 flex-shrink-0 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />

            {/* Content */}
            <div className="flex-1 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-2">
                <div className="h-4 w-28 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                <div className="h-3 w-20 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              </div>

              {/* Tweet text */}
              <div className="space-y-2">
                <div className="h-4 w-full rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                <div className="h-4 w-4/5 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                <div className="h-4 w-3/5 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              </div>

              {/* Engagement bar */}
              <div className="flex gap-12 pt-2">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-5 w-12 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Profile header skeleton — for profile page loading
 */
export function ProfileHeaderSkeleton() {
  return (
    <div className="border-b border-[rgb(var(--color-border-primary))]">
      {/* Banner */}
      <div className="h-48 bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />

      {/* Profile info */}
      <div className="relative px-4 pb-4">
        {/* Avatar */}
        <div className="absolute -top-16 h-32 w-32 rounded-full border-4 border-[rgb(var(--color-bg-primary))] bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />

        {/* Edit profile button skeleton */}
        <div className="flex justify-end pt-3">
          <div className="h-9 w-28 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
        </div>

        {/* Name and username */}
        <div className="mt-3 space-y-2">
          <div className="h-6 w-40 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
          <div className="h-4 w-28 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
        </div>

        {/* Bio */}
        <div className="mt-3 space-y-2">
          <div className="h-4 w-full rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
          <div className="h-4 w-3/4 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
        </div>

        {/* Stats */}
        <div className="mt-4 flex gap-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-4 w-24 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * User list skeleton — for followers/following lists
 */
export function UserListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="border-b border-[rgb(var(--color-border-primary))] px-4 py-3"
        >
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className="h-12 w-12 flex-shrink-0 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />

            {/* User info */}
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              <div className="h-3 w-24 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              <div className="h-4 w-full rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              <div className="h-4 w-2/3 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
            </div>

            {/* Follow button */}
            <div className="h-8 w-20 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Generic card skeleton — for various loading states
 */
export function CardSkeleton({
  className,
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-[rgb(var(--color-bg-secondary))] p-4",
        className
      )}
    >
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-4 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer"
            style={{ width: `${100 - i * 10}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Search result skeleton — for search page
 */
export function SearchResultSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="border-b border-[rgb(var(--color-border-primary))] px-4 py-4"
        >
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className="h-12 w-12 flex-shrink-0 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />

            {/* Content */}
            <div className="flex-1 space-y-2">
              {/* Name/username */}
              <div className="flex items-center gap-2">
                <div className="h-4 w-28 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                <div className="h-3 w-20 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              </div>

              {/* Tweet preview or bio */}
              <div className="space-y-1.5">
                <div className="h-4 w-full rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                <div className="h-4 w-4/5 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Notification skeleton — for notifications page
 */
export function NotificationSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="border-b border-[rgb(var(--color-border-primary))] px-4 py-4"
        >
          <div className="flex gap-3">
            {/* Icon placeholder */}
            <div className="h-8 w-8 flex-shrink-0 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />

            {/* Content */}
            <div className="flex-1 space-y-2">
              {/* Avatar(s) */}
              <div className="flex gap-2">
                <div className="h-8 w-8 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                <div className="h-8 w-8 rounded-full bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              </div>

              {/* Text */}
              <div className="space-y-1.5">
                <div className="h-4 w-full rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
                <div className="h-4 w-2/3 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
              </div>

              {/* Timestamp */}
              <div className="h-3 w-16 rounded bg-[rgb(var(--color-bg-tertiary))] skeleton-shimmer" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
