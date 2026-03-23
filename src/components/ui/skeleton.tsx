import { cn } from "./utils";

/**
 * Skeleton loader component
 *
 * Unified skeleton pattern for all loading states across the application.
 *
 * **Usage:**
 * ```tsx
 * // Default shimmer effect (recommended)
 * <Skeleton className="h-4 w-32 rounded" />
 *
 * // Pulse animation variant
 * <Skeleton variant="pulse" className="h-12 w-12 rounded-full" />
 *
 * // With explicit dimensions
 * <Skeleton width={200} height={100} />
 * ```
 *
 * **Important:** Do NOT override the background color via className.
 * The shimmer animation includes its own gradient background using CSS variables.
 * Overriding breaks the visual effect.
 *
 * @see src/app/globals.css for shimmer animation definition
 */
export interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  /**
   * Visual style for the skeleton animation
   * - "shimmer": Gradient shimmer effect (default, more polished)
   * - "pulse": Simple pulse animation (lighter weight)
   */
  variant?: "shimmer" | "pulse";
}

export function Skeleton({ className, width, height, variant = "shimmer" }: SkeletonProps) {
  const style: React.CSSProperties = {};

  if (width) {
    style.width = typeof width === "number" ? `${width}px` : width;
  }

  if (height) {
    style.height = typeof height === "number" ? `${height}px` : height;
  }

  const animationClasses = variant === "shimmer" ? "skeleton-shimmer" : "animate-pulse bg-[rgb(var(--color-bg-tertiary))]";

  return (
    <div
      className={cn("rounded", animationClasses, className)}
      style={style}
      role="status"
      aria-busy="true"
      aria-label="Loading"
    />
  );
}
