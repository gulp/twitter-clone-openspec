"use client";

import { useEffect, useState } from "react";

/**
 * Debounce hook with configurable delay
 *
 * Returns a debounced value that only updates after the delay
 * has elapsed with no changes to the input value.
 *
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 300ms for search)
 * @returns Debounced value
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up the timeout
    const timeoutId = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup function to cancel timeout if value changes
    return () => {
      clearTimeout(timeoutId);
    };
  }, [value, delay]);

  return debouncedValue;
}
