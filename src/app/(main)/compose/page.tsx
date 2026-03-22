"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { Composer } from "@/components/Composer";

export default function ComposePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  if (!session) return null;

  return (
    <div>
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-twitter-border">
        <h1 className="font-bold text-xl px-4 py-3 text-twitter-text-light">
          New Post
        </h1>
      </div>
      <Composer onSuccess={() => router.push("/home")} />
    </div>
  );
}
