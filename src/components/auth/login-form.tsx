"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emailSchema } from "@/lib/validators";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

const loginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginFormSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formData, setFormData] = useState<LoginFormData>({
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof LoginFormData, string>>>({});
  const [serverError, setServerError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (field: keyof LoginFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear field error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    // Clear server error when user modifies form
    if (serverError) {
      setServerError("");
    }
  };

  const validateForm = (): boolean => {
    const result = loginFormSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof LoginFormData, string>> = {};
      for (const error of result.error.errors) {
        const field = error.path[0] as keyof LoginFormData;
        fieldErrors[field] = error.message;
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (result?.error) {
        setServerError("Invalid email or password");
        setIsLoading(false);
        return;
      }

      // Success - redirect to home or callbackUrl
      const callbackUrl = searchParams.get("callbackUrl") || "/home";
      router.push(callbackUrl);
      router.refresh();
    } catch (error) {
      console.error("Login error:", error);
      setServerError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {serverError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">{serverError}</p>
        </div>
      )}

      <Input
        type="email"
        placeholder="Email address"
        value={formData.email}
        onChange={(e) => handleChange("email", e.target.value)}
        error={errors.email}
        disabled={isLoading}
        className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-[#1DA1F2] focus:ring-[#1DA1F2]/20"
        autoComplete="email"
      />

      <Input
        type="password"
        placeholder="Password"
        value={formData.password}
        onChange={(e) => handleChange("password", e.target.value)}
        error={errors.password}
        disabled={isLoading}
        className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-[#1DA1F2] focus:ring-[#1DA1F2]/20"
        autoComplete="current-password"
      />

      <div className="flex justify-end">
        <Link
          href="/reset-password"
          className="text-sm text-[#1DA1F2] hover:underline transition-all"
        >
          Forgot password?
        </Link>
      </div>

      <Button
        type="submit"
        disabled={isLoading}
        loading={isLoading}
        className="w-full bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white font-bold rounded-full py-3 transition-all duration-200 disabled:opacity-50"
      >
        Log in
      </Button>
    </form>
  );
}
