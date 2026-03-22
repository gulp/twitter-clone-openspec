import { type ClassValue, clsx } from "clsx";
import { formatDistanceToNow } from "date-fns";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx and tailwind-merge
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format date as relative time (e.g., "2 hours ago")
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Cursor payload for time-ordered pagination
 */
type CursorPayload = { ts: string; id: string };

/**
 * Encode cursor from last item in page
 * Per §1.2: opaque base64url-encoded compound cursor
 */
export function encodeCursor(item: { createdAt: Date; id: string }): string {
  const payload: CursorPayload = {
    ts: item.createdAt.toISOString(),
    id: item.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Decode cursor to WHERE clause components
 * Per §1.2: opaque base64url-encoded compound cursor
 */
export function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, "base64url").toString());
}

/**
 * Generate username for OAuth users
 * Per §1.6: lowercase, strip non-alphanumeric, truncate to 9 chars, append _cuid6
 * Example: "John Doe" + cuid "clx9abc123def" → "johndoe_clx9ab"
 */
export function generateUsername(displayName: string, cuid: string): string {
  // Lowercase and strip non-alphanumeric characters
  const sanitized =
    (displayName || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 9) || "user";

  // Take first 6 chars of CUID
  const cuidPrefix = cuid.slice(0, 6);

  // Combine with underscore
  return `${sanitized}_${cuidPrefix}`;
}
