"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { passwordSchema } from "@/lib/validators";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

const resetCompleteSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetFormData = z.infer<typeof resetCompleteSchema>;

export default function CompleteResetPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();

  // Get token from URL path param or query param
  const token = (params.token as string) || searchParams.get("token") || "";

  const [formData, setFormData] = useState<ResetFormData>({
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ResetFormData, string>>>({});
  const [serverError, setServerError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const completeResetMutation = trpc.auth.completeReset.useMutation();

  const handleChange = (field: keyof ResetFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    if (serverError) {
      setServerError("");
    }
  };

  const validateForm = (): boolean => {
    const result = resetCompleteSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof ResetFormData, string>> = {};
      for (const error of result.error.errors) {
        const field = error.path[0] as keyof ResetFormData;
        fieldErrors[field] = error.message;
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const getPasswordStrength = (
    password: string
  ): { strength: number; label: string; color: string } => {
    if (password.length === 0) return { strength: 0, label: "", color: "" };
    if (password.length < 8) return { strength: 1, label: "Too short", color: "bg-red-500" };

    let strength = 1;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    if (strength <= 2) return { strength: 2, label: "Weak", color: "bg-orange-500" };
    if (strength === 3) return { strength: 3, label: "Good", color: "bg-yellow-500" };
    return { strength: 4, label: "Strong", color: "bg-green-500" };
  };

  const passwordStrength = getPasswordStrength(formData.password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");

    if (!token) {
      setServerError("Invalid reset link. Please request a new password reset.");
      return;
    }

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      await completeResetMutation.mutateAsync({
        token,
        password: formData.password,
      });

      setSuccess(true);

      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (error: unknown) {
      console.error("Password reset completion error:", error);
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "Failed to reset password. This link may have expired.";
      setServerError(message);
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Invalid reset link</h2>
          <p className="text-gray-400 text-sm">
            This password reset link is invalid or has expired.
          </p>
        </div>

        <div className="text-center pt-4">
          <Link
            href="/reset-password"
            className="text-[#1DA1F2] hover:underline font-medium transition-all"
          >
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-label="Success"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Password reset successful</h2>
          <p className="text-gray-400 text-sm">
            Your password has been reset. Redirecting to login...
          </p>
        </div>

        <div className="text-center">
          <Link href="/login" className="text-[#1DA1F2] hover:underline font-medium transition-all">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Set new password</h2>
        <p className="text-gray-400 text-sm">Enter a new password for your account</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {serverError && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">{serverError}</p>
          </div>
        )}

        <div className="space-y-2">
          <Input
            type="password"
            placeholder="New password (min 8 chars)"
            value={formData.password}
            onChange={(e) => handleChange("password", e.target.value)}
            error={errors.password}
            disabled={isLoading}
            className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-[#1DA1F2] focus:ring-[#1DA1F2]/20"
            autoComplete="new-password"
            autoFocus
          />

          {formData.password && (
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((level) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      level <= passwordStrength.strength ? passwordStrength.color : "bg-gray-700"
                    }`}
                  />
                ))}
              </div>
              {passwordStrength.label && (
                <p className="text-xs text-gray-400">
                  Password strength: <span className="font-medium">{passwordStrength.label}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <Input
          type="password"
          placeholder="Confirm new password"
          value={formData.confirmPassword}
          onChange={(e) => handleChange("confirmPassword", e.target.value)}
          error={errors.confirmPassword}
          disabled={isLoading}
          className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-[#1DA1F2] focus:ring-[#1DA1F2]/20"
          autoComplete="new-password"
        />

        <Button
          type="submit"
          disabled={isLoading}
          loading={isLoading}
          className="w-full bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white font-bold rounded-full py-3 transition-all duration-200 disabled:opacity-50"
        >
          Reset password
        </Button>

        <div className="text-center pt-4 border-t border-gray-800">
          <Link href="/login" className="text-gray-400 hover:text-white transition-all text-sm">
            Back to login
          </Link>
        </div>
      </form>
    </div>
  );
}
