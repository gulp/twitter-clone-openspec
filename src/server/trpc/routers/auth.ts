import { createHash, randomBytes } from "node:crypto";
import { env } from "@/env";
import { registerSchema, resetCompleteSchema, resetRequestSchema } from "@/lib/validators";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { sendPasswordResetEmail } from "../../services/email";
import { checkAuthIPRateLimit } from "../../services/rate-limiter";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../index";

/**
 * Sleep for a given number of milliseconds.
 * Used for timing-attack prevention in requestReset (§1.4).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get client IP address from request headers.
 * Used for IP-based rate limiting.
 */
function getClientIP(req: Request | undefined): string {
  if (!req) return "unknown";

  const headers = req.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown"
  );
}

/**
 * Auth router — registration, login, password reset, logout.
 *
 * All auth endpoints are subject to IP-based rate limiting (5/min per IP).
 */
export const authRouter = createTRPCRouter({
  /**
   * Register a new user account.
   *
   * Validates input, checks email+username uniqueness, hashes password (bcrypt cost 12),
   * creates user record.
   *
   * Error messages (per spec):
   * - "Email already in use" on duplicate email
   * - "Username already taken" on duplicate username
   *
   * Note: This mutation creates the user but does not create a session.
   * The client must then call NextAuth signIn to establish a session.
   */
  register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
    // Rate limit check (5/min per IP, fail closed)
    const ip = getClientIP(ctx.req);
    try {
      const rateLimit = await checkAuthIPRateLimit(ip);

      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many requests. Try again in ${rateLimit.retryAfter} seconds.`,
        });
      }
    } catch (error) {
      // Convert "Rate limiting unavailable" to INTERNAL_SERVER_ERROR
      if (error instanceof Error && error.message === "Rate limiting unavailable") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Service temporarily unavailable",
        });
      }
      throw error;
    }

    const { email, username, displayName, password } = input;

    // Check email uniqueness
    const existingEmail = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingEmail) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Email already in use",
      });
    }

    // Check username uniqueness
    const existingUsername = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });

    if (existingUsername) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Username already taken",
      });
    }

    // Hash password (bcrypt cost 12)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user — catch P2002 for concurrent registration race
    try {
      const user = await prisma.user.create({
        data: {
          email,
          username,
          displayName,
          hashedPassword,
        },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          createdAt: true,
        },
      });

      return { user };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const target = (error as { meta?: { target?: string[] } }).meta?.target;
        if (target?.includes("email")) {
          throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
        }
        if (target?.includes("username")) {
          throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
        }
        throw new TRPCError({ code: "CONFLICT", message: "Email or username already in use" });
      }
      throw error;
    }
  }),

  /**
   * Request a password reset email.
   *
   * Security requirements (§1.4):
   * 1. ALWAYS return generic success response regardless of email existence (prevent enumeration)
   * 2. Fire-and-forget email send (void sendResetEmail(...)) to prevent timing oracle
   * 3. Enforce minimum 200ms response delay to flatten timing signals
   * 4. Rate limited (5/min per IP, fail closed)
   *
   * If email exists:
   * - Invalidate all prior active (unused, unexpired) reset tokens for the user
   * - Generate new reset token (32 random bytes, hex-encoded)
   * - Store SHA-256 hash of token in DB with 1-hour expiry
   * - Send reset email with raw token in URL
   */
  requestReset: publicProcedure.input(resetRequestSchema).mutation(async ({ input, ctx }) => {
    const startTime = Date.now();

    // Rate limit check (5/min per IP, fail closed)
    const ip = getClientIP(ctx.req);
    try {
      const rateLimit = await checkAuthIPRateLimit(ip);

      if (!rateLimit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many requests. Try again in ${rateLimit.retryAfter} seconds.`,
        });
      }
    } catch (error) {
      // Convert "Rate limiting unavailable" to INTERNAL_SERVER_ERROR
      if (error instanceof Error && error.message === "Rate limiting unavailable") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Service temporarily unavailable",
        });
      }
      throw error;
    }

    const { email } = input;

    // Look up user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    // If user exists, create reset token and send email
    if (user) {
      // Invalidate all prior active tokens for this user
      await prisma.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          used: false,
          expiresAt: { gt: new Date() },
        },
        data: { used: true },
      });

      // Generate reset token (32 random bytes, hex-encoded)
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      // Store token hash in DB (1-hour expiry)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt,
        },
      });

      // Construct reset URL
      const resetUrl = `${env.APP_ORIGIN}/reset-password?token=${rawToken}`;

      // Fire-and-forget email send (NEVER await)
      sendPasswordResetEmail(user.email, resetUrl);
    }

    // Enforce minimum 200ms response time to prevent timing oracle
    const elapsed = Date.now() - startTime;
    if (elapsed < 200) {
      await sleep(200 - elapsed);
    }

    // Always return generic success message (same response regardless of email existence)
    return {
      message:
        "If an account exists with that email, you will receive a password reset link shortly.",
    };
  }),

  /**
   * Complete password reset with token.
   *
   * Validates token (SHA-256 hash lookup), checks expiry and unused status,
   * updates password, increments sessionVersion (invalidates all sessions),
   * marks token as used.
   */
  completeReset: publicProcedure.input(resetCompleteSchema).mutation(async ({ input }) => {
    const { token, password } = input;

    // Hash the token to look up in DB
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Find token record
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, sessionVersion: true } } },
    });

    // Validate token exists, not used, and not expired
    if (!resetToken) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid or expired reset token",
      });
    }

    if (resetToken.used) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Reset token has already been used",
      });
    }

    if (resetToken.expiresAt < new Date()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Reset token has expired",
      });
    }

    // Hash new password (bcrypt cost 12)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update user password, increment sessionVersion, mark token as used
    // Use transaction to ensure atomicity
    await prisma.$transaction([
      // Update password and increment sessionVersion (invalidates all sessions)
      prisma.user.update({
        where: { id: resetToken.userId },
        data: {
          hashedPassword,
          sessionVersion: { increment: 1 },
        },
      }),

      // Mark token as used
      prisma.passwordResetToken.update({
        where: { tokenHash },
        data: { used: true },
      }),
    ]);

    return {
      message: "Password reset successful. Please log in with your new password.",
    };
  }),

  /**
   * Logout from all devices/sessions.
   *
   * Increments User.sessionVersion, which invalidates all existing JWTs.
   * The JWT callback in NextAuth checks token.sv === User.sessionVersion (§1.10).
   */
  logoutAll: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Increment sessionVersion to invalidate all JWTs
    await prisma.user.update({
      where: { id: userId },
      data: {
        sessionVersion: { increment: 1 },
      },
    });

    return {
      message: "Logged out from all devices successfully.",
    };
  }),
});
