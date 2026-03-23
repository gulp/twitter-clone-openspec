import { type ClassValue, clsx } from "clsx";
import { format, formatDistanceToNow } from "date-fns";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx and tailwind-merge
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format date as relative time (e.g., "2 hours ago") or specific format
 * Returns fallback string if date is invalid
 */
export function formatDate(date: Date | string, formatType?: "monthYear"): string {
  const d = typeof date === "string" ? new Date(date) : date;

  // Guard against Invalid Date
  if (Number.isNaN(d.getTime())) {
    return formatType === "monthYear" ? "Invalid date" : "Unknown time";
  }

  if (formatType === "monthYear") {
    return format(d, "MMMM yyyy");
  }

  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Generate username for OAuth users
 * Per §1.6: lowercase, strip non-alphanumeric, truncate to 8 chars, append _cuid6
 * Total: 8 + 1 + 6 = 15 chars (usernameSchema max)
 * Example: "John Doe" + cuid "clx9abc123def" → "johndoe_clx9ab"
 */
export function generateUsername(displayName: string, cuid: string): string {
  // Lowercase and strip non-alphanumeric characters
  const sanitized =
    (displayName || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8) || "user";

  // Take first 6 chars of CUID
  const cuidPrefix = cuid.slice(0, 6);

  // Combine with underscore (total max 15 chars: 8 + 1 + 6)
  return `${sanitized}_${cuidPrefix}`;
}

/**
 * Validate and sanitize redirect URL to prevent open redirect attacks
 * Only allows relative paths within the app
 * Rejects absolute URLs, protocol-relative URLs, and javascript: URIs
 */
export function safeRedirectUrl(url: string | null | undefined, defaultPath = "/home"): string {
  if (!url) {
    return defaultPath;
  }

  // Must start with / but not // (reject protocol-relative URLs like //evil.com)
  if (!url.startsWith("/") || url.startsWith("//")) {
    return defaultPath;
  }

  // Reject URLs with protocol schemes (javascript:, data:, http:, etc.)
  if (url.includes(":")) {
    return defaultPath;
  }

  return url;
}

/**
 * Escape HTML special characters to prevent injection
 * Encodes &, <, >, ", and ' to their HTML entity equivalents
 */
export function escapeHtml(text: string): string {
  const htmlEscapeMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
}
