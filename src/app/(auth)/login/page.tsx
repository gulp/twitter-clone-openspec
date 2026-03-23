import { LoginForm } from "@/components/auth/login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { Suspense } from "react";

export const metadata = {
  title: "Log in to Twitter Clone",
  description: "Log in to your account",
};

// Map NextAuth OAuth error codes to user-friendly messages
function getOAuthErrorMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;

  const errorMessages: Record<string, string> = {
    OAuthSignin: "Failed to start sign-in with the provider. Please try again.",
    OAuthCallback: "Failed to process sign-in. Please try again.",
    OAuthCreateAccount: "Failed to create your account. Please try again or use a different sign-in method.",
    OAuthAccountNotLinked: "This email is already associated with another account. Please sign in using your original method.",
  };

  return errorMessages[errorCode] || "An error occurred during sign-in. Please try again.";
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const oauthError = getOAuthErrorMessage(searchParams.error ?? null);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Welcome back</h2>
        <p className="text-gray-400 text-sm">Sign in to continue</p>
      </div>

      {oauthError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">{oauthError}</p>
        </div>
      )}

      <OAuthButtons />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-800" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-black text-gray-400">or</span>
        </div>
      </div>

      <Suspense fallback={<Skeleton className="h-64 rounded-lg" />}>
        <LoginForm />
      </Suspense>

      <div className="text-center pt-4 border-t border-gray-800">
        <p className="text-gray-400 text-sm">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="text-[#1DA1F2] hover:underline font-medium transition-all"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
