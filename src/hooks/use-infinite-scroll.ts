"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * IntersectionObserver hook for infinite scroll
 *
 * Returns a ref to attach to a sentinel element. When the sentinel
 * enters the viewport (with configurable threshold and rootMargin),
 * the callback fires to load more content.
 *
 * @param callback - Function to call when sentinel enters viewport
 * @param enabled - Whether observation is active (default: true)
 * @param threshold - Intersection ratio threshold (default: 0.5)
 * @param rootMargin - Root margin for early triggering (default: "100px")
 * @returns Ref to attach to sentinel element
 */
export function useInfiniteScroll(
  callback: () => void,
  enabled = true,
  threshold = 0.5,
  rootMargin = "100px"
) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(callback);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry?.isIntersecting && enabled) {
        callbackRef.current();
      }
    },
    [enabled]
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !enabled) return;

    const observer = new IntersectionObserver(handleIntersection, {
      threshold,
      rootMargin,
    });

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [enabled, threshold, rootMargin, handleIntersection]);

  return sentinelRef;
}
