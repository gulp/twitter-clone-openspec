import { authOptions } from "@/server/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

/**
 * Root page — redirects based on auth state.
 *
 * Authenticated → /home (main feed)
 * Unauthenticated → /login
 *
 * This is a Server Component — session check happens on the server,
 * so the redirect is instant (no flash of loading state).
 */
export default async function RootPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/home");
  }

  redirect("/login");
}
