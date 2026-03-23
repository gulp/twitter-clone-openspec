import { updateProfileSchema } from "@/lib/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma, publicUserSelect, selfUserSelect } from "../../db";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../index";
import { validateMediaUrls } from "./media";

/**
 * User router
 *
 * Procedures:
 * - getByUsername: public query to fetch user profile by username
 * - updateProfile: protected mutation to update own profile
 */
export const userRouter = createTRPCRouter({
  /**
   * getByUsername — Get user profile by username
   *
   * - Public endpoint (anyone can view profiles)
   * - Returns 404 if user not found
   * - Includes isFollowing boolean for authenticated users
   * - Uses publicUserSelect (I1 — never expose email or hashedPassword)
   */
  getByUsername: publicProcedure
    .input(z.object({ username: z.string().max(15) }))
    .query(async ({ ctx, input }) => {
      const { username } = input;

      const user = await prisma.user.findUnique({
        where: { username },
        select: publicUserSelect,
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Check if authenticated user is following this user
      let isFollowing = false;
      if (ctx.session?.user?.id) {
        const follow = await prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: ctx.session.user.id,
              followingId: user.id,
            },
          },
        });
        isFollowing = !!follow;
      }

      return {
        ...user,
        isFollowing,
      };
    }),

  /**
   * updateProfile — Update own profile
   *
   * - Protected endpoint (user must be authenticated)
   * - Validates displayName and bio with Zod schemas (I7)
   * - Validates avatar/banner URLs match S3 bucket origin
   * - Returns updated profile with selfUserSelect (I2 — includes email for own profile)
   */
  updateProfile: protectedProcedure.input(updateProfileSchema).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const { displayName, bio, avatarUrl, bannerUrl } = input;

    // Validate avatar/banner URLs if provided
    if (avatarUrl) {
      validateMediaUrls([avatarUrl], userId, "avatar");
    }
    if (bannerUrl) {
      validateMediaUrls([bannerUrl], userId, "banner");
    }

    // Normalize empty bio to null for consistency
    const normalizedBio = bio === "" ? null : bio;

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(bio !== undefined && { bio: normalizedBio }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(bannerUrl !== undefined && { bannerUrl }),
      },
      select: selfUserSelect,
    });

    return updatedUser;
  }),
});
