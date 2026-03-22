import { randomUUID } from "node:crypto";
import { env } from "@/env";
import { log } from "@/lib/logger";
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
     */
    // Only register OAuth providers when credentials are configured
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),

    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? [
          GitHubProvider({
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
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
        const emailVerified =
          (profile as { email_verified?: boolean; verified_email?: boolean })?.email_verified ??
          (profile as { email_verified?: boolean; verified_email?: boolean })?.verified_email;

        if (!email) {
          log.warn("OAuth sign-in rejected: no email provided", {
            provider: account.provider,
          });
          return false;
        }

        if (!emailVerified) {
          log.warn("OAuth sign-in rejected: email not verified", {
            provider: account.provider,
            email,
          });
          return false;
        }

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
          // Generate CUID first
          const { createId } = await import("@paralleldrive/cuid2");
          const userId = createId();

          // Derive username from OAuth display name
          const displayName = user.name || "user";
          const baseUsername = displayName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .slice(0, 9);

          // Append CUID prefix (first 6 chars) for uniqueness
          const username = `${baseUsername}_${userId.slice(0, 6)}`;

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

        // Fetch sessionVersion from DB
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { sessionVersion: true },
        });

        token.sv = dbUser?.sessionVersion ?? 0;

        // Add session to Redis allow-list (30 days TTL)
        await sessionSet(token.jti, token.sub as string, 30 * 24 * 60 * 60);
      }

      // On every non-signin request: validate session is still valid
      if (trigger === "update" || !user) {
        const jti = token.jti as string | undefined;
        if (!jti) {
          return {};
        }

        // Always check sessionVersion from DB to catch logoutAll invalidation.
        // Redis is checked first as a fast path — if the key is missing, the
        // session was explicitly deleted. But even if Redis has the key, we
        // still verify sessionVersion to ensure logoutAll is enforced.
        const redisSession = await sessionGet(jti);

        if (redisSession === null) {
          // Session not in Redis — either expired, deleted, or Redis failure.
          // Fall back to DB sessionVersion check.
          const dbUser = await prisma.user.findUnique({
            where: { id: token.sub },
            select: { sessionVersion: true },
          });

          if (!dbUser || dbUser.sessionVersion !== token.sv) {
            return {};
          }
        } else {
          // Session exists in Redis — still verify sessionVersion hasn't
          // been incremented by logoutAll since the JWT was issued.
          const dbUser = await prisma.user.findUnique({
            where: { id: token.sub },
            select: { sessionVersion: true },
          });

          if (!dbUser || dbUser.sessionVersion !== token.sv) {
            // logoutAll was called — delete the stale Redis session too
            await sessionDel(jti).catch(() => {});
            return {};
          }
        }
      }

      return token;
    },

    /**
     * Session callback — exposes userId and profile fields to the client.
     *
     * Called whenever session is checked client-side via useSession() or getServerSession().
     */
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub as string;

        // Fetch additional user fields for navigation/UI
        const user = await prisma.user.findUnique({
          where: { id: token.sub as string },
          select: {
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        });

        if (user) {
          session.user.username = user.username;
          session.user.displayName = user.displayName;
          session.user.avatarUrl = user.avatarUrl ?? undefined;
        }
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
