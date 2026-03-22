"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface InfiniteScrollProps {
  children: ReactNode;
  onLoadMore: () => void;
  hasMore: boolean;
  loading?: boolean;
  threshold?: number;
  loader?: ReactNode;
}

export function InfiniteScroll({
  children,
  onLoadMore,
  hasMore,
  loading = false,
  threshold = 0.8,
  loader,
}: InfiniteScrollProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!hasMore || loading) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          loadMoreRef.current();
        }
      },
      {
        threshold,
        rootMargin: "100px",
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, threshold]);

  return (
    <div>
      {children}
      {hasMore && (
        <div ref={sentinelRef} className="w-full py-4 flex justify-center">
          {loading && (loader || <div className="text-gray-500">Loading...</div>)}
        </div>
      )}
    </div>
  );
}
