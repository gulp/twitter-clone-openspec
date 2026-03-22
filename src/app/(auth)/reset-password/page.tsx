"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { emailSchema } from "@/lib/validators";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

const resetRequestSchema = z.object({
  email: emailSchema,
});

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const requestResetMutation = trpc.auth.requestReset.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    // Validate email
    const result = resetRequestSchema.safeParse({ email });
    if (!result.success) {
      setError(result.error.errors[0]?.message || "Invalid email");
      return;
    }

    setIsLoading(true);

    try {
      await requestResetMutation.mutateAsync({ email });
      setSuccess(true);
      setEmail("");
    } catch (err: unknown) {
      console.error("Password reset request error:", err);
      // Even on error, show generic success message (per security spec)
      setSuccess(true);
      setEmail("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Reset your password</h2>
        <p className="text-gray-400 text-sm">
          Enter your email and we&apos;ll send you a link to reset your password
        </p>
      </div>

      {success ? (
        <div className="space-y-6">
          <div className="p-4 bg-[#1DA1F2]/10 border border-[#1DA1F2]/20 rounded-lg">
            <p className="text-sm text-[#1DA1F2] text-center">
              If an account exists with that email, you will receive a password reset link shortly.
            </p>
          </div>

          <div className="text-center space-y-3">
            <Link
              href="/login"
              className="block text-[#1DA1F2] hover:underline font-medium transition-all"
            >
              Back to login
            </Link>
            <button
              onClick={() => setSuccess(false)}
              className="block w-full text-gray-400 hover:text-white transition-all text-sm"
            >
              Send another email
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <Input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
            error={error}
            disabled={isLoading}
            className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-[#1DA1F2] focus:ring-[#1DA1F2]/20"
            autoComplete="email"
            autoFocus
          />

          <Button
            type="submit"
            disabled={isLoading}
            loading={isLoading}
            className="w-full bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white font-bold rounded-full py-3 transition-all duration-200 disabled:opacity-50"
          >
            Send reset link
          </Button>

          <div className="text-center pt-4 border-t border-gray-800">
            <Link href="/login" className="text-gray-400 hover:text-white transition-all text-sm">
              Back to login
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
