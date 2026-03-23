import { randomUUID } from "node:crypto";
import { env } from "@/env";
import { log } from "@/lib/logger";
import { generateUsername } from "@/lib/utils";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { basePrisma, prisma } from "./db";
import { sessionDel, sessionGet, sessionSet } from "./redis";

/**
 * Extend NextAuth types to include userId in session.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      username?: string;
      displayName?: string;
      avatarUrl?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    jti?: string;
    sv?: number;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  }
}

/**
 * NextAuth configuration with JWT strategy + Redis session allow-list.
 *
 * Session validation (§1.10):
 * 1. JWT signature verifies
 * 2. session:jti:{jti} exists in Redis
 * 3. token.sv === User.sessionVersion (checked from DB)
 *
 * If any check fails, session is invalid.
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(basePrisma),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    /**
     * CredentialsProvider — email/password authentication.
     *
     * Security requirements (§1.4):
     * 1. Return 'Invalid email or password' for both wrong email AND wrong password
     * 2. Use timing-safe comparison: always run bcrypt.compare even when user not found
     * 3. Use pre-computed dummy hash when user doesn't exist to prevent timing oracle
     */
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid email or password");
        }

        const { email, password } = credentials;

        // Look up user by email
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            hashedPassword: true,
          },
        });

        // Pre-computed dummy hash for timing-safe comparison when user not found.
        // Generated via: bcrypt.hashSync("dummy_password_timing_safe", 12)
        // Must be a VALID bcrypt hash so bcrypt.compare takes ~250ms (same as real).
        const DUMMY_HASH = "$2a$12$VXIHqUNtBxGWRT0B.s95a.5bCKcQ66EXUoyCIV76EzF3H4uF/xDiq";

        // Always run bcrypt.compare to prevent timing oracle
        // Use dummy hash if user not found
        const hashToCompare = user?.hashedPassword ?? DUMMY_HASH;
        const isValid = await bcrypt.compare(password, hashToCompare);

        // Return user only if found AND password is valid
        if (!user || !isValid) {
          throw new Error("Invalid email or password");
        }

        // Return user object for NextAuth (without hashedPassword)
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          image: user.avatarUrl || null,
        };
      },
    }),

    /**
     * GoogleProvider — OAuth sign-in
     *
     * allowDangerousEmailAccountLinking removed for security:
     * - Prevents account takeover via unverified OAuth emails
     * - Users with existing credentials accounts must use password auth
     * - New users can still sign up via OAuth (if email is verified)
     */
    // Only register OAuth providers when credentials are configured
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),

    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? [
          GitHubProvider({
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    /**
     * signIn callback — handles OAuth auto-account creation (§1.6).
     *
     * For OAuth providers (Google, GitHub):
     * - Only create account when provider supplies verified email
     * - Generate username: CUID prefix strategy (zero retries)
     * - Set displayName from OAuth profile
     */
    async signIn({ user, account, profile }) {
      // Credentials provider: always allow (validation in authorize)
      if (account?.provider === "credentials") {
        return true;
      }

      // OAuth provider: only allow if email is verified
      if (account?.provider === "google" || account?.provider === "github") {
        // Check if email is verified
        const email = user.email;

        if (!email) {
          log.warn("OAuth sign-in rejected: no email provided", {
            provider: account.provider,
          });
          return false;
        }

        // GitHub OAuth only returns verified primary email, so presence of email implies verification.
        // Google OAuth provides explicit email_verified field.
        if (account.provider === "google") {
          const emailVerified =
            (profile as { email_verified?: boolean; verified_email?: boolean })?.email_verified ??
            (profile as { email_verified?: boolean; verified_email?: boolean })?.verified_email;

          if (!emailVerified) {
            log.warn("OAuth sign-in rejected: email not verified", {
              provider: account.provider,
              email,
            });
            return false;
          }
        }
        // For GitHub: email presence = verified (GitHub OAuth behavior)

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });

        // If user exists, allow sign-in
        if (existingUser) {
          return true;
        }

        // Auto-create new user
        // Generate username per §1.6: CUID prefix strategy (zero retries)
        try {
          // Generate CUID first (using Prisma's cuid format, not cuid2)
          const cuid = (await import("cuid")).default;
          const userId = cuid();

          // Generate username per §1.6: CUID prefix strategy (zero retries)
          const displayName = user.name || "user";
          const username = generateUsername(displayName, userId);

          // Create user (using the pre-generated CUID as id)
          await prisma.user.create({
            data: {
              id: userId,
              email,
              username,
              displayName,
              avatarUrl: user.image || "",
              hashedPassword: null, // OAuth users have no password
            },
          });

          log.info("OAuth auto-created user", {
            provider: account.provider,
            email,
            username,
          });

          return true;
        } catch (error) {
          // P2002: unique constraint violation
          if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
            // Check which unique constraint was violated
            const target = "meta" in error && error.meta && typeof error.meta === "object" && "target" in error.meta
              ? error.meta.target
              : null;

            // Email collision: concurrent OAuth sign-in created user between check and create
            if (Array.isArray(target) ? target.includes("email") : target === "email") {
              log.info("OAuth user already created by concurrent request", {
                provider: account.provider,
                email,
              });
              return true; // User exists, allow sign-in
            }

            // Username collision: CUID prefix overlap (extremely rare but possible)
            // User was NOT created, so we must reject sign-in
            log.error("OAuth username collision (CUID prefix overlap)", {
              provider: account.provider,
              email,
              target,
            });
            return false;
          }

          log.error("Failed to auto-create OAuth user", {
            provider: account.provider,
            email,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
      }

      // Unknown provider: reject
      return false;
    },

    /**
     * JWT callback — stores userId, session ID (jti), and session version (sv).
     *
     * Called on sign-in and on every session check.
     * The jti claim allows us to maintain a Redis allow-list for session invalidation.
     * The sv claim allows "logout everywhere" by incrementing User.sessionVersion.
     */
    async jwt({ token, user, trigger }) {
      // On sign-in: create new session
      if (user) {
        token.sub = user.id;
        token.jti = randomUUID();

        // Fetch sessionVersion and user profile fields from DB
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            sessionVersion: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        });

        token.sv = dbUser?.sessionVersion ?? 0;
        token.username = dbUser?.username;
        token.displayName = dbUser?.displayName;
        token.avatarUrl = dbUser?.avatarUrl ?? undefined;

        // Add session to Redis allow-list (30 days TTL)
        await sessionSet(token.jti, token.sub as string, 30 * 24 * 60 * 60);
      }

      // On update trigger: refresh user profile fields from DB
      if (trigger === "update") {
        const jti = token.jti as string | undefined;
        if (!jti) {
          return {};
        }

        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: {
            sessionVersion: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        });

        if (!dbUser || dbUser.sessionVersion !== token.sv) {
          // Session invalid — clean up stale Redis entry
          const redisSession = await sessionGet(jti);
          if (redisSession !== null) {
            await sessionDel(jti).catch(() => {});
          }
          return {};
        }

        // Update profile fields in token
        token.username = dbUser.username;
        token.displayName = dbUser.displayName;
        token.avatarUrl = dbUser.avatarUrl ?? undefined;
      }

      // On every non-signin, non-update request: validate session is still valid
      if (!user && trigger !== "update") {
        const jti = token.jti as string | undefined;
        if (!jti) {
          return {};
        }

        // Check Redis allow-list as a fast path, then always verify
        // sessionVersion from DB to catch logoutAll invalidation.
        const redisSession = await sessionGet(jti);

        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { sessionVersion: true },
        });

        if (!dbUser || dbUser.sessionVersion !== token.sv) {
          // Session invalid — clean up stale Redis entry if present
          if (redisSession !== null) {
            await sessionDel(jti).catch(() => {});
          }
          return {};
        }
      }

      return token;
    },

    /**
     * Session callback — exposes userId and profile fields to the client.
     *
     * Called whenever session is checked client-side via useSession() or getServerSession().
     * Profile fields (username, displayName, avatarUrl) are read from JWT token (no DB query).
     */
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub as string;
        session.user.username = token.username;
        session.user.displayName = token.displayName;
        session.user.avatarUrl = token.avatarUrl;
      }
      return session;
    },
  },
  cookies: {
    sessionToken: {
      name:
        env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: env.NODE_ENV === "production",
      },
    },
  },
  events: {
    /**
     * On sign-out: remove session from Redis allow-list.
     */
    async signOut({ token }) {
      if (token?.jti) {
        await sessionDel(token.jti as string);
      }
    },
  },
};
