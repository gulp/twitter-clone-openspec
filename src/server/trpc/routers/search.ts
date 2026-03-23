import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, publicUserSelect } from "../../db";
import { createTRPCRouter, publicProcedure } from "../index";

/**
 * Search router
 *
 * Procedures:
 * - tweets: full-text search on tweet content with PostgreSQL tsvector
 * - users: substring search on username and displayName with ILIKE
 */

/**
 * Input validator for search queries.
 *
 * Sanitization rules (§1.22):
 * - Reject empty/whitespace queries
 * - Strip SQL wildcards (%, _)
 * - Cap at 50 characters
 * - Enforce minimum normalized length of 2 characters
 */
const searchQuerySchema = z
  .string()
  .min(1)
  .transform((q) => {
    // Strip leading/trailing whitespace
    const trimmed = q.trim();

    // Reject empty queries
    if (trimmed.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Search query cannot be empty",
      });
    }

    // Strip SQL wildcards and ILIKE escape char, cap at 50 chars
    const sanitized = trimmed.replace(/[%_\\]/g, "").slice(0, 50);

    // Enforce minimum normalized length
    if (sanitized.length < 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Search query must be at least 2 characters",
      });
    }

    return sanitized;
  });

/**
 * Cursor schema for tweet search.
 *
 * Cursor payload: { rank, ts, id }
 * Order: rank DESC, createdAt DESC, id DESC
 */
const tweetSearchCursorSchema = z
  .string()
  .optional()
  .transform((cursor) => {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
      const rank = Number(parsed.rank);
      const ts = new Date(parsed.ts);
      const id = String(parsed.id ?? "");
      if (Number.isNaN(rank) || Number.isNaN(ts.getTime()) || !id) {
        throw new Error("Invalid cursor fields");
      }
      return { rank, ts, id };
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid cursor",
      });
    }
  });

/**
 * Cursor schema for user search.
 *
 * Cursor payload: { followerCount, id }
 * Order: followerCount DESC, id DESC
 */
const userSearchCursorSchema = z
  .string()
  .optional()
  .transform((cursor) => {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
      const followerCount = Number(parsed.followerCount);
      const id = String(parsed.id ?? "");
      if (Number.isNaN(followerCount) || !id) {
        throw new Error("Invalid cursor fields");
      }
      return { followerCount, id };
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid cursor",
      });
    }
  });

export const searchRouter = createTRPCRouter({
  /**
   * tweets — Full-text search on tweet content
   *
   * - Public endpoint (anyone can search)
   * - Uses PostgreSQL tsvector with plainto_tsquery for English stemming
   * - Ordered by ts_rank DESC, createdAt DESC, id DESC
   * - Cursor pagination with { rank, ts, id } payload
   * - Excludes deleted tweets (I3)
   * - Includes hasLiked/hasRetweeted for authenticated users (§1.16)
   * - All SQL parameterized via Prisma.sql (I8)
   */
  tweets: publicProcedure
    .input(
      z.object({
        query: searchQuerySchema,
        cursor: tweetSearchCursorSchema,
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const { query, cursor, limit } = input;

      // Raw SQL query using Prisma.sql tagged template (§1.22)
      // CRITICAL: NEVER use string interpolation for user input (I8)
      const tweets = await prisma.$queryRaw<
        Array<{
          id: string;
          content: string;
          authorId: string;
          parentId: string | null;
          mediaUrls: string[];
          createdAt: Date;
          likeCount: number;
          retweetCount: number;
          replyCount: number;
          rank: number;
        }>
      >(
        Prisma.sql`
          SELECT t.id, t.content, t."authorId", t."parentId", t."mediaUrls",
                 t."createdAt", t."likeCount", t."retweetCount", t."replyCount",
                 ts_rank(t.search_vector, query) AS rank
          FROM "Tweet" t, plainto_tsquery('english', ${query}) query
          WHERE t.search_vector @@ query
            AND t.deleted = false
            AND (
              ${cursor === null}::boolean OR
              ts_rank(t.search_vector, query) < ${cursor?.rank ?? 0}::numeric OR
              (ts_rank(t.search_vector, query) = ${cursor?.rank ?? 0}::numeric AND (
                t."createdAt" < ${cursor?.ts ?? new Date()}::timestamptz OR
                (t."createdAt" = ${cursor?.ts ?? new Date()}::timestamptz AND t.id < ${cursor?.id ?? ""}::text)
              ))
            )
          ORDER BY rank DESC, t."createdAt" DESC, t.id DESC
          LIMIT ${limit + 1}
        `
      );

      // Hydrate authors using publicUserSelect (I1)
      const authorIds = [...new Set(tweets.map((t) => t.authorId))];
      const authors = await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: publicUserSelect,
      });
      const authorMap = new Map(authors.map((a) => [a.id, a]));

      // Batch-check hasLiked/hasRetweeted for authenticated users (§1.16)
      let likesMap = new Map<string, boolean>();
      let retweetsMap = new Map<string, boolean>();

      if (ctx.session?.user?.id && tweets.length > 0) {
        const userId = ctx.session.user.id;
        const tweetIds = tweets.map((t) => t.id);

        const [likes, retweets] = await Promise.all([
          prisma.like.findMany({
            where: {
              userId,
              tweetId: { in: tweetIds },
            },
            select: { tweetId: true },
          }),
          prisma.retweet.findMany({
            where: {
              userId,
              tweetId: { in: tweetIds },
            },
            select: { tweetId: true },
          }),
        ]);

        likesMap = new Map(likes.map((like) => [like.tweetId, true]));
        retweetsMap = new Map(retweets.map((rt) => [rt.tweetId, true]));
      }

      // Determine next cursor
      let nextCursor: string | null = null;
      if (tweets.length > limit) {
        const nextItem = tweets.pop();
        if (nextItem) {
          const cursorPayload = {
            rank: nextItem.rank,
            ts: nextItem.createdAt.toISOString(),
            id: nextItem.id,
          };
          nextCursor = Buffer.from(JSON.stringify(cursorPayload), "utf-8").toString("base64url");
        }
      }

      // Map results with author and engagement state
      const items = tweets.map((tweet) => {
        const author = authorMap.get(tweet.authorId);
        if (!author) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Author not found for tweet",
          });
        }
        return {
          id: tweet.id,
          content: tweet.content,
          authorId: tweet.authorId,
          parentId: tweet.parentId,
          mediaUrls: tweet.mediaUrls,
          createdAt: tweet.createdAt,
          likeCount: tweet.likeCount,
          retweetCount: tweet.retweetCount,
          replyCount: tweet.replyCount,
          author,
          hasLiked: likesMap.get(tweet.id) ?? false,
          hasRetweeted: retweetsMap.get(tweet.id) ?? false,
        };
      });

      return {
        items,
        nextCursor,
      };
    }),

  /**
   * users — Substring search on username and displayName
   *
   * - Public endpoint (anyone can search)
   * - ILIKE search on username and displayName (case-insensitive)
   * - Ordered by followerCount DESC, id DESC (popularity first)
   * - Cursor pagination with { followerCount, id } payload
   * - Returns publicUserSelect fields (I1)
   * - All SQL parameterized via Prisma.sql (I8)
   */
  users: publicProcedure
    .input(
      z.object({
        query: searchQuerySchema,
        cursor: userSearchCursorSchema,
        limit: z.number().int().positive().max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const { query, cursor, limit } = input;

      // Raw SQL query using Prisma.sql tagged template (§1.22)
      // CRITICAL: NEVER use string interpolation for user input (I8)
      const users = await prisma.$queryRaw<
        Array<{
          id: string;
          username: string;
          displayName: string;
          avatarUrl: string | null;
          bannerUrl: string | null;
          bio: string | null;
          followerCount: number;
          createdAt: Date;
          followingCount: number;
          tweetCount: number;
        }>
      >(
        Prisma.sql`
          SELECT id, username, "displayName", "avatarUrl", "bannerUrl", bio, "followerCount",
                 "createdAt", "followingCount", "tweetCount"
          FROM "User"
          WHERE (
                username ILIKE '%' || ${query} || '%'
                OR "displayName" ILIKE '%' || ${query} || '%'
              )
            AND (
              ${cursor === null}::boolean OR
              "followerCount" < ${cursor?.followerCount ?? 0}::int OR
              ("followerCount" = ${cursor?.followerCount ?? 0}::int AND id < ${cursor?.id ?? ""}::text)
            )
          ORDER BY "followerCount" DESC, id DESC
          LIMIT ${limit + 1}
        `
      );

      // Determine next cursor
      let nextCursor: string | null = null;
      if (users.length > limit) {
        const nextItem = users.pop();
        if (nextItem) {
          const cursorPayload = {
            followerCount: nextItem.followerCount,
            id: nextItem.id,
          };
          nextCursor = Buffer.from(JSON.stringify(cursorPayload), "utf-8").toString("base64url");
        }
      }

      return {
        items: users,
        nextCursor,
      };
    }),
});
