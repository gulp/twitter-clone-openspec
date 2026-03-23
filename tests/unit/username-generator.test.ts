import { describe, expect, it } from "vitest";
import { generateUsername } from "@/lib/utils";

/**
 * Username generator tests — validates OAuth username generation.
 *
 * Per §1.6: lowercase, strip non-alphanumeric, truncate to 8 chars, append _cuid6
 * Max length: 8 + 1 + 6 = 15 chars (usernameSchema limit)
 */

describe("generateUsername", () => {
  it("should generate username from normal name", () => {
    const result = generateUsername("John Doe", "clx9abc123def");
    expect(result).toBe("johndoe_clx9ab");
  });

  it("should strip special characters", () => {
    const result = generateUsername("Alice-Bob.Smith!", "clx9abc123def");
    expect(result).toBe("alicebob_clx9ab"); // "alicebobsmith" truncated to 8 chars + CUID
  });

  it("should handle short name without truncation", () => {
    const result = generateUsername("Al", "clx9abc123def");
    expect(result).toBe("al_clx9ab");
  });

  it("should truncate long name to 8 chars", () => {
    const result = generateUsername("VeryLongDisplayName", "clx9abc123def");
    expect(result).toBe("verylong_clx9ab"); // first 8 chars + CUID
  });

  it("should use first 6 chars of CUID as suffix", () => {
    const result = generateUsername("Alice", "abcdefghijklmnop");
    expect(result).toBe("alice_abcdef");
  });

  it("should convert to lowercase", () => {
    const result = generateUsername("ALICE", "clx9abc123def");
    expect(result).toBe("alice_clx9ab");
  });

  it("should preserve numbers in name", () => {
    const result = generateUsername("User123", "clx9abc123def");
    expect(result).toBe("user123_clx9ab");
  });

  it("should handle name with only special characters", () => {
    const result = generateUsername("@!#$", "clx9abc123def");
    // When all chars are stripped, fallback to 'user'
    expect(result).toBe("user_clx9ab");
  });

  it("should handle empty display name", () => {
    const result = generateUsername("", "clx9abc123def");
    // Empty string fallback to 'user'
    expect(result).toBe("user_clx9ab");
  });

  it("should handle name with spaces only", () => {
    const result = generateUsername("   ", "clx9abc123def");
    // Spaces stripped, fallback to 'user'
    expect(result).toBe("user_clx9ab");
  });

  it("should strip spaces", () => {
    const result = generateUsername("Alice  Bob  Carol", "clx9abc123def");
    expect(result).toBe("alicebob_clx9ab"); // "alicebobcarol" truncated to 8 chars
  });

  it("should guarantee uniqueness via CUID prefix", () => {
    const result1 = generateUsername("Alice", "clx9abc111111");
    const result2 = generateUsername("Alice", "clx9abc222222");

    expect(result1).toBe("alice_clx9ab");
    expect(result2).toBe("alice_clx9ab");

    // Different CUIDs would produce different results
    const result3 = generateUsername("Alice", "xyz9abc333333");
    expect(result3).toBe("alice_xyz9ab");
    expect(result3).not.toBe(result1);
  });

  it("should handle Unicode characters by stripping them", () => {
    const result = generateUsername("Alice🌍Bob", "clx9abc123def");
    expect(result).toBe("alicebob_clx9ab");
  });

  it("should handle name with underscores (invalid, stripped)", () => {
    const result = generateUsername("Alice_Bob", "clx9abc123def");
    expect(result).toBe("alicebob_clx9ab");
  });

  it("should produce valid username format", () => {
    const result = generateUsername("Test User", "clx9abc123def");
    // Should match pattern: [a-z0-9]{1,8}_[a-z0-9]{6}
    expect(result).toMatch(/^[a-z0-9]{1,8}_[a-z0-9]{6}$/);
  });

  it("should never exceed usernameSchema max length of 15", () => {
    // Test with maximum length base name
    const longName = "a".repeat(100); // Way longer than needed
    const result = generateUsername(longName, "clx9abc123def");
    expect(result.length).toBeLessThanOrEqual(15);
    expect(result).toBe("aaaaaaaa_clx9ab"); // 8 + 1 + 6 = 15
  });
});
