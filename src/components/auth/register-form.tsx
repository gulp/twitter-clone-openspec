"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { registerSchema } from "@/lib/validators";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";

type RegisterFormData = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const router = useRouter();
  const [formData, setFormData] = useState<RegisterFormData>({
    email: "",
    username: "",
    displayName: "",
    password: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof RegisterFormData, string>>>({});
  const [serverError, setServerError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const registerMutation = trpc.auth.register.useMutation();

  const handleChange = (field: keyof RegisterFormData, value: string) => {
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
    const result = registerSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof RegisterFormData, string>> = {};
      result.error.errors.forEach((error) => {
        const field = error.path[0] as keyof RegisterFormData;
        fieldErrors[field] = error.message;
      });
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

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      // Register user via tRPC
      await registerMutation.mutateAsync(formData);

      // Auto-login after registration
      const result = await signIn("credentials", {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (result?.error) {
        // Registration succeeded but login failed - redirect to login page
        router.push("/login?message=Registration successful. Please log in.");
        return;
      }

      // Success - redirect to home
      router.push("/home");
      router.refresh();
    } catch (error: any) {
      console.error("Registration error:", error);

      // Handle tRPC errors with specific messages
      if (error?.message) {
        setServerError(error.message);
      } else {
        setServerError("An unexpected error occurred. Please try again.");
      }
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {serverError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg animate-in fade-in slide-in-from-top-2 duration-300">
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
        type="text"
        placeholder="Username (3-15 chars, alphanumeric + _)"
        value={formData.username}
        onChange={(e) => handleChange("username", e.target.value)}
        error={errors.username}
        disabled={isLoading}
        className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-[#1DA1F2] focus:ring-[#1DA1F2]/20"
        autoComplete="username"
      />

      <Input
        type="text"
        placeholder="Display name"
        value={formData.displayName}
        onChange={(e) => handleChange("displayName", e.target.value)}
        error={errors.displayName}
        disabled={isLoading}
        className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-[#1DA1F2] focus:ring-[#1DA1F2]/20"
        autoComplete="name"
      />

      <div className="space-y-2">
        <Input
          type="password"
          placeholder="Password (min 8 chars)"
          value={formData.password}
          onChange={(e) => handleChange("password", e.target.value)}
          error={errors.password}
          disabled={isLoading}
          className="bg-transparent border-gray-700 text-white placeholder:text-gray-500 focus:border-[#1DA1F2] focus:ring-[#1DA1F2]/20"
          autoComplete="new-password"
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

      <Button
        type="submit"
        disabled={isLoading}
        loading={isLoading}
        className="w-full bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white font-bold rounded-full py-3 transition-all duration-200 disabled:opacity-50"
      >
        Create account
      </Button>
    </form>
  );
}
