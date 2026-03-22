import { authOptions } from "@/server/auth";
import NextAuth from "next-auth";

/**
 * NextAuth API route handler.
 *
 * This exports GET and POST handlers for all NextAuth endpoints:
 * - /api/auth/signin
 * - /api/auth/signout
 * - /api/auth/callback/*
 * - /api/auth/session
 * - /api/auth/providers
 * - /api/auth/csrf
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
