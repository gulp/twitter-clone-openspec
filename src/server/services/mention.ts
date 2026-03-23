import { prisma } from "../db";

/**
 * Mention service
 *
 * Parses @username mentions from tweet text and resolves them to user IDs.
 */

/**
 * parseMentions — Extract @username mentions from tweet text
 *
 * @param text - Tweet content
 * @returns Array of unique mentioned usernames (without @ prefix)
 *
 * Handles:
 * - @username at start, middle, end of text
 * - Consecutive @mentions
 * - @username followed by punctuation
 * - Invalid usernames (non-alphanumeric, underscore) ignored
 */
export function parseMentions(text: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_]{3,15})\b/g;
  const mentions = new Set<string>();

  let match: RegExpExecArray | null = mentionRegex.exec(text);
  while (match !== null) {
    if (match[1]) mentions.add(match[1]); // capture group 1 = username without @
    match = mentionRegex.exec(text);
  }

  return Array.from(mentions);
}

/**
 * resolveMentions — Look up usernames and return existing user IDs
 *
 * @param usernames - Array of usernames (without @ prefix)
 * @returns Array of user IDs for users that exist
 *
 * Non-existent users are silently ignored.
 */
export async function resolveMentions(usernames: string[]): Promise<string[]> {
  if (usernames.length === 0) {
    return [];
  }

  // Normalize to lowercase — usernames are stored lowercase but
  // @mentions in tweets may use mixed case (e.g. @JohnDoe → johndoe)
  const normalized = usernames.map((u) => u.toLowerCase());

  // Query database for matching usernames
  const users = await prisma.user.findMany({
    where: {
      username: {
        in: normalized,
      },
    },
    select: {
      id: true,
    },
  });

  return users.map((u) => u.id);
}
