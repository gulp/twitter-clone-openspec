"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push("/home");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        <svg viewBox="0 0 24 24" className="w-10 h-10 text-twitter-text-light fill-current mx-auto mb-8">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>

        <h1 className="text-3xl font-bold text-twitter-text-light mb-8 text-center">
          Sign in
        </h1>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-500 rounded-lg px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-transparent border border-twitter-border rounded-lg px-4 py-3 text-twitter-text-light placeholder-twitter-text-gray focus:outline-none focus:border-twitter-blue"
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-transparent border border-twitter-border rounded-lg px-4 py-3 text-twitter-text-light placeholder-twitter-text-gray focus:outline-none focus:border-twitter-blue"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-twitter-text-light text-black rounded-full py-3 font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-twitter-text-gray text-center">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-twitter-blue hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
