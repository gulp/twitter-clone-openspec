import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { RegisterForm } from "@/components/auth/register-form";
import Link from "next/link";

export const metadata = {
  title: "Create your account",
  description: "Join Twitter Clone today",
};

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">Join today</h2>
        <p className="text-gray-400 text-sm">Create your account</p>
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

      <RegisterForm />

      <div className="text-center pt-4 border-t border-gray-800">
        <p className="text-gray-400 text-sm">
          Already have an account?{" "}
          <Link href="/login" className="text-[#1DA1F2] hover:underline font-medium transition-all">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
