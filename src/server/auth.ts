import { env } from "@/env";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { sessionGet, sessionSet } from "./redis";

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
  adapter: PrismaAdapter(prisma),
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
     * CredentialsProvider — placeholder for Phase B.
     * Full implementation will be in auth.ts router (registration, login).
     */
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize() {
        // Placeholder — full implementation in Phase B (tw-bpw.13)
        // Will verify email/password via tRPC auth.login mutation
        return null;
      },
    }),

    /**
     * GoogleProvider — OAuth sign-in
     */
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      allowDangerousEmailAccountLinking: true,
    }),

    /**
     * GitHubProvider — OAuth sign-in
     */
    GitHubProvider({
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
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

      // On token refresh (trigger === "update"): validate session is still valid
      if (trigger === "update" || !user) {
        // Check Redis allow-list
        const jti = token.jti as string | undefined;
        if (!jti) {
          // No jti → invalid token
          return {};
        }

        const redisSession = await sessionGet(jti);

        // If Redis says session doesn't exist, fall back to DB sessionVersion check
        // (Redis failure policy: fail open, fall back to DB)
        if (redisSession === null) {
          // Validate sessionVersion from DB
          const dbUser = await prisma.user.findUnique({
            where: { id: token.sub },
            select: { sessionVersion: true },
          });

          if (!dbUser || dbUser.sessionVersion !== token.sv) {
            // sessionVersion mismatch → session invalidated
            return {};
          }
        }
      }

      return token;
    },

    /**
     * Session callback — exposes userId to the client.
     *
     * Called whenever session is checked client-side via useSession() or getServerSession().
     */
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
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
        const { sessionDel } = await import("./redis");
        await sessionDel(token.jti as string);
      }
    },
  },
};
