"use client";

import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export interface SearchInputProps {
  onQueryChange?: (query: string) => void;
  className?: string;
}

/**
 * Search input with icon, clear button, and URL persistence
 *
 * Features:
 * - Search icon on the left
 * - Clear button (X) on the right when input has value
 * - Reads initial value from URL query param 'q'
 * - Updates URL on input change (managed by parent via onQueryChange)
 * - Controlled component
 */
export function SearchInput({ onQueryChange, className }: SearchInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localValue, setLocalValue] = useState(searchParams.get("q") || "");

  // Sync with URL on mount and when searchParams change
  useEffect(() => {
    const urlQuery = searchParams.get("q") || "";
    setLocalValue(urlQuery);
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    // Notify parent (parent will debounce and update URL)
    if (onQueryChange) {
      onQueryChange(newValue);
    }
  };

  const handleClear = () => {
    setLocalValue("");
    if (onQueryChange) {
      onQueryChange("");
    }
    // Clear URL query param but preserve tab parameter
    const params = new URLSearchParams();
    const currentTab = searchParams.get("tab");
    if (currentTab) {
      params.set("tab", currentTab);
    }
    const newUrl = params.toString() ? `/search?${params.toString()}` : "/search";
    router.push(newUrl);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Form submission is handled by parent's debounce + URL update
  };

  return (
    <form onSubmit={handleSubmit} className={cn("w-full", className)}>
      <div className="relative">
        {/* Search icon */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#71767B] pointer-events-none">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Input field */}
        <input
          type="text"
          value={localValue}
          onChange={handleChange}
          placeholder="Search Twitter"
          className={cn(
            "w-full pl-12 pr-12 py-3 bg-[#202327] border border-[#2F3336] rounded-full text-[#E7E9EA] placeholder-[#71767B]",
            "focus:outline-none focus:border-[#1DA1F2] focus:bg-[#000000]",
            "transition-colors"
          )}
          aria-label="Search"
        />

        {/* Clear button */}
        {localValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#1DA1F2] hover:bg-[#1DA1F2]/10 rounded-full p-1 transition-colors"
            aria-label="Clear search"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M13.414 12l5.793-5.793c.39-.39.39-1.023 0-1.414s-1.023-.39-1.414 0L12 10.586 6.207 4.793c-.39-.39-1.023-.39-1.414 0s-.39 1.023 0 1.414L10.586 12l-5.793 5.793c-.39.39-.39 1.023 0 1.414.195.195.45.293.707.293s.512-.098.707-.293L12 13.414l5.793 5.793c.195.195.45.293.707.293s.512-.098.707-.293c.39-.39.39-1.023 0-1.414L13.414 12z" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
