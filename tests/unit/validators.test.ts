import {
  bioSchema,
  displayNameSchema,
  emailSchema,
  loginSchema,
  paginationSchema,
  passwordSchema,
  registerSchema,
  resetCompleteSchema,
  resetRequestSchema,
  tweetContentSchema,
  updateProfileSchema,
  usernameSchema,
} from "@/lib/validators";
import { describe, expect, it } from "vitest";

/**
 * Validator tests — validates all Zod schemas with boundary values and invalid formats.
 */

describe("usernameSchema", () => {
  it("should accept valid username", () => {
    expect(usernameSchema.parse("alice")).toBe("alice");
    expect(usernameSchema.parse("alice_123")).toBe("alice_123");
    expect(usernameSchema.parse("ABC")).toBe("ABC");
  });

  it("should reject username shorter than 3 chars", () => {
    expect(() => usernameSchema.parse("ab")).toThrow();
  });

  it("should reject username longer than 15 chars", () => {
    expect(() => usernameSchema.parse("a".repeat(16))).toThrow();
  });

  it("should accept username with exactly 3 chars", () => {
    expect(usernameSchema.parse("abc")).toBe("abc");
  });

  it("should accept username with exactly 15 chars", () => {
    expect(usernameSchema.parse("a".repeat(15))).toBe("a".repeat(15));
  });

  it("should reject username with special characters", () => {
    expect(() => usernameSchema.parse("alice-bob")).toThrow();
    expect(() => usernameSchema.parse("alice.bob")).toThrow();
    expect(() => usernameSchema.parse("alice@bob")).toThrow();
  });

  it("should accept username with underscores and numbers", () => {
    expect(usernameSchema.parse("alice_123")).toBe("alice_123");
  });
});

describe("passwordSchema", () => {
  it("should accept password with 8 chars", () => {
    expect(passwordSchema.parse("12345678")).toBe("12345678");
  });

  it("should accept password longer than 8 chars", () => {
    expect(passwordSchema.parse("a".repeat(72))).toBe("a".repeat(72));
  });

  it("should reject password longer than 72 chars (bcrypt limit)", () => {
    expect(() => passwordSchema.parse("a".repeat(73))).toThrow();
  });

  it("should reject password shorter than 8 chars", () => {
    expect(() => passwordSchema.parse("1234567")).toThrow();
  });
});

describe("displayNameSchema", () => {
  it("should accept valid display name", () => {
    expect(displayNameSchema.parse("Alice Smith")).toBe("Alice Smith");
  });

  it("should accept display name with exactly 1 char", () => {
    expect(displayNameSchema.parse("A")).toBe("A");
  });

  it("should accept display name with exactly 50 chars", () => {
    expect(displayNameSchema.parse("a".repeat(50))).toBe("a".repeat(50));
  });

  it("should reject empty display name", () => {
    expect(() => displayNameSchema.parse("")).toThrow();
  });

  it("should reject display name longer than 50 chars", () => {
    expect(() => displayNameSchema.parse("a".repeat(51))).toThrow();
  });
});

describe("bioSchema", () => {
  it("should accept empty bio", () => {
    expect(bioSchema.parse("")).toBe("");
  });

  it("should accept bio with 160 chars", () => {
    expect(bioSchema.parse("a".repeat(160))).toBe("a".repeat(160));
  });

  it("should reject bio longer than 160 chars", () => {
    expect(() => bioSchema.parse("a".repeat(161))).toThrow();
  });

  it("should accept bio with special characters", () => {
    expect(bioSchema.parse("Hello! 👋 Welcome to my profile.")).toBe(
      "Hello! 👋 Welcome to my profile."
    );
  });
});

describe("tweetContentSchema", () => {
  it("should accept tweet with 1 char", () => {
    expect(tweetContentSchema.parse("a")).toBe("a");
  });

  it("should accept tweet with exactly 280 chars", () => {
    expect(tweetContentSchema.parse("a".repeat(280))).toBe("a".repeat(280));
  });

  it("should reject empty content (per plan §1.15, API uses .optional() for media-only)", () => {
    expect(() => tweetContentSchema.parse("")).toThrow();
  });

  it("should reject tweet with 281 chars", () => {
    expect(() => tweetContentSchema.parse("a".repeat(281))).toThrow();
  });

  it("should accept tweet with emojis and special characters", () => {
    const tweet = "Hello world! 🌍 #test @user";
    expect(tweetContentSchema.parse(tweet)).toBe(tweet);
  });
});

describe("emailSchema", () => {
  it("should accept valid email", () => {
    expect(emailSchema.parse("alice@example.com")).toBe("alice@example.com");
  });

  it("should reject invalid email format", () => {
    expect(() => emailSchema.parse("alice")).toThrow();
    expect(() => emailSchema.parse("alice@")).toThrow();
    expect(() => emailSchema.parse("@example.com")).toThrow();
  });

  it("should accept email with subdomain", () => {
    expect(emailSchema.parse("alice@mail.example.com")).toBe("alice@mail.example.com");
  });

  it("should normalize email to lowercase", () => {
    expect(emailSchema.parse("User@Example.com")).toBe("user@example.com");
    expect(emailSchema.parse("ALICE@EXAMPLE.COM")).toBe("alice@example.com");
    expect(emailSchema.parse("AlIcE@ExAmPlE.CoM")).toBe("alice@example.com");
  });
});

describe("registerSchema", () => {
  it("should accept valid registration data", () => {
    const data = {
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice",
      password: "password123",
    };
    expect(registerSchema.parse(data)).toEqual(data);
  });

  it("should reject registration with invalid email", () => {
    const data = {
      email: "invalid-email",
      username: "alice",
      displayName: "Alice",
      password: "password123",
    };
    expect(() => registerSchema.parse(data)).toThrow();
  });

  it("should reject registration with short password", () => {
    const data = {
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice",
      password: "short",
    };
    expect(() => registerSchema.parse(data)).toThrow();
  });
});

describe("loginSchema", () => {
  it("should accept valid login data", () => {
    const data = {
      email: "alice@example.com",
      password: "anypassword",
    };
    expect(loginSchema.parse(data)).toEqual(data);
  });

  it("should accept login with any password length", () => {
    // Login doesn't enforce min length (per validators.ts line 30)
    const data = {
      email: "alice@example.com",
      password: "ab",
    };
    expect(loginSchema.parse(data)).toEqual(data);
  });
});

describe("resetRequestSchema", () => {
  it("should accept valid reset request", () => {
    const data = { email: "alice@example.com" };
    expect(resetRequestSchema.parse(data)).toEqual(data);
  });

  it("should reject invalid email", () => {
    expect(() => resetRequestSchema.parse({ email: "invalid" })).toThrow();
  });
});

describe("resetCompleteSchema", () => {
  it("should accept valid reset completion", () => {
    const data = {
      token: "a".repeat(64),
      password: "newpassword123",
    };
    expect(resetCompleteSchema.parse(data)).toEqual(data);
  });

  it("should reject short password", () => {
    const data = {
      token: "a".repeat(64),
      password: "short",
    };
    expect(() => resetCompleteSchema.parse(data)).toThrow();
  });
});

describe("updateProfileSchema", () => {
  it("should accept valid profile update", () => {
    const data = {
      displayName: "Alice Smith",
      bio: "Software developer",
      avatarUrl: "https://example.com/avatar.jpg",
      bannerUrl: "https://example.com/banner.jpg",
    };
    expect(updateProfileSchema.parse(data)).toEqual(data);
  });

  it("should accept partial profile update", () => {
    const data = { displayName: "Alice Smith" };
    expect(updateProfileSchema.parse(data)).toEqual(data);
  });

  it("should accept empty object", () => {
    expect(updateProfileSchema.parse({})).toEqual({});
  });

  it("should reject invalid URL for avatarUrl", () => {
    const data = { avatarUrl: "not-a-url" };
    expect(() => updateProfileSchema.parse(data)).toThrow();
  });

  it("should reject invalid URL for bannerUrl", () => {
    const data = { bannerUrl: "not-a-url" };
    expect(() => updateProfileSchema.parse(data)).toThrow();
  });
});

describe("paginationSchema", () => {
  it("should accept valid pagination", () => {
    const data = { cursor: "abc123", limit: 20 };
    expect(paginationSchema.parse(data)).toEqual(data);
  });

  it("should use default limit when not provided", () => {
    const data = { cursor: "abc123" };
    expect(paginationSchema.parse(data)).toEqual({ cursor: "abc123", limit: 20 });
  });

  it("should accept empty object with defaults", () => {
    expect(paginationSchema.parse({})).toEqual({ limit: 20 });
  });

  it("should reject negative limit", () => {
    expect(() => paginationSchema.parse({ limit: -1 })).toThrow();
  });

  it("should reject limit over 100", () => {
    expect(() => paginationSchema.parse({ limit: 101 })).toThrow();
  });

  it("should accept limit of exactly 100", () => {
    expect(paginationSchema.parse({ limit: 100 })).toEqual({ limit: 100 });
  });

  it("should reject zero limit", () => {
    expect(() => paginationSchema.parse({ limit: 0 })).toThrow();
  });
});
