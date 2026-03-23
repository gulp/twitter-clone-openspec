"use client";

import { SearchInput } from "@/components/search/search-input";
import { SearchResults } from "@/components/search/search-results";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * Search page with tweet and user search
 *
 * Public page showing:
 * - Search input at top with debounce (300ms)
 * - Tabs for Tweets and People
 * - Search results with infinite scroll
 * - Empty states for no results
 *
 * Features:
 * - URL persistence for query and active tab
 * - 300ms debounce before executing search
 * - Real-time search as user types (after debounce)
 */
function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const debouncedQuery = useDebounce(query, 300);

  // Track searchParams in a ref to avoid re-triggering the URL update effect
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  // Update URL when debounced query changes
  useEffect(() => {
    const params = new URLSearchParams(searchParamsRef.current.toString());

    if (debouncedQuery) {
      params.set("q", debouncedQuery);
    } else {
      params.delete("q");
    }

    // Preserve tab parameter if it exists
    const currentTab = searchParamsRef.current.get("tab");
    if (currentTab) {
      params.set("tab", currentTab);
    }

    const newUrl = params.toString() ? `/search?${params.toString()}` : "/search";
    router.replace(newUrl);
  }, [debouncedQuery, router]);

  return (
    <div className="min-h-screen bg-[#0F1419]">
      {/* Header with search input */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-[#0F1419]/95 border-b border-[#38444d]">
        <div className="px-4 py-3">
          <SearchInput onQueryChange={setQuery} />
        </div>
      </div>

      {/* Search results */}
      <div className="pb-16">
        {debouncedQuery ? (
          <SearchResults query={debouncedQuery} />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <svg
              className="w-20 h-20 text-[#71767B] mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <p className="text-[#E7E9EA] text-2xl font-bold mb-2">Search Twitter</p>
            <p className="text-[#71767B] text-center max-w-md">Find tweets and people on Twitter</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0F1419]">
          <div className="sticky top-0 z-20 backdrop-blur-md bg-[#0F1419]/95 border-b border-[#38444d]">
            <div className="px-4 py-3">
              <Skeleton className="h-10 rounded-full" />
            </div>
          </div>
        </div>
      }
    >
      <SearchPageContent />
    </Suspense>
  );
}
