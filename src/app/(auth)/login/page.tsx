import { LoginForm } from "@/components/auth/login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import Link from "next/link";
import { Suspense } from "react";

export const metadata = {
  title: "Log in to Twitter Clone",
  description: "Log in to your account",
};

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Welcome back</h2>
        <p className="text-gray-400 text-sm">Sign in to continue</p>
      </div>

      <OAuthButtons />

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-800" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-black text-gray-400">or</span>
        </div>
      </div>

      <Suspense
        fallback={
          <div
            className="h-64 animate-pulse bg-gray-800/20 rounded-lg"
            role="status"
            aria-busy="true"
            aria-label="Loading"
          />
        }
      >
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
