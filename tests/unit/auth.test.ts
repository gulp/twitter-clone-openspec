import { authOptions } from "@/server/auth";
import { describe, expect, it } from "vitest";

describe("NextAuth configuration", () => {
  it("should export authOptions", () => {
    expect(authOptions).toBeDefined();
  });

  it("should use jwt session strategy", () => {
    expect(authOptions.session?.strategy).toBe("jwt");
  });

  it("should have 30 day session maxAge", () => {
    expect(authOptions.session?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("should configure three providers", () => {
    expect(authOptions.providers).toHaveLength(3);
  });

  it("should use PrismaAdapter", () => {
    expect(authOptions.adapter).toBeDefined();
  });

  it("should have jwt callback", () => {
    expect(authOptions.callbacks?.jwt).toBeDefined();
  });

  it("should have session callback", () => {
    expect(authOptions.callbacks?.session).toBeDefined();
  });

  it("should configure secure cookies for production", () => {
    const cookieName =
      process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token";
    expect(authOptions.cookies?.sessionToken?.name).toBe(cookieName);
    expect(authOptions.cookies?.sessionToken?.options?.httpOnly).toBe(true);
    expect(authOptions.cookies?.sessionToken?.options?.sameSite).toBe("lax");
  });
});
