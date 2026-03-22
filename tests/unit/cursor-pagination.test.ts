import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/lib/utils";

/**
 * Cursor pagination tests — validates encode/decode round-trip and edge cases.
 *
 * Per §1.2: opaque base64url-encoded compound cursor with { ts, id }
 */

describe("encodeCursor / decodeCursor", () => {
  it("should round-trip encode and decode", () => {
    const original = {
      createdAt: new Date("2024-01-15T10:30:00.000Z"),
      id: "clx9abc123def",
    };

    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.ts).toBe("2024-01-15T10:30:00.000Z");
    expect(decoded.id).toBe("clx9abc123def");
  });

  it("should handle cursor with special characters in date", () => {
    const original = {
      createdAt: new Date("2024-12-31T23:59:59.999Z"),
      id: "clx9abc123def",
    };

    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.ts).toBe("2024-12-31T23:59:59.999Z");
    expect(decoded.id).toBe("clx9abc123def");
  });

  it("should handle CUID with various characters", () => {
    const original = {
      createdAt: new Date("2024-01-15T10:30:00.000Z"),
      id: "clx9_ABC-xyz",
    };

    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.id).toBe("clx9_ABC-xyz");
  });

  it("should produce base64url-encoded string", () => {
    const original = {
      createdAt: new Date("2024-01-15T10:30:00.000Z"),
      id: "clx9abc123def",
    };

    const cursor = encodeCursor(original);

    // base64url should not contain +, /, or =
    expect(cursor).not.toMatch(/[+/=]/);
    // Should be a non-empty string
    expect(cursor.length).toBeGreaterThan(0);
  });

  it("should handle epoch date (edge case)", () => {
    const original = {
      createdAt: new Date(0),
      id: "clx9abc123def",
    };

    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.ts).toBe("1970-01-01T00:00:00.000Z");
    expect(decoded.id).toBe("clx9abc123def");
  });

  it("should handle far-future date", () => {
    const original = {
      createdAt: new Date("2099-12-31T23:59:59.999Z"),
      id: "clx9abc123def",
    };

    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.ts).toBe("2099-12-31T23:59:59.999Z");
    expect(decoded.id).toBe("clx9abc123def");
  });

  it("should throw on invalid cursor (not base64url)", () => {
    expect(() => decodeCursor("invalid!!!cursor")).toThrow();
  });

  it("should throw on invalid cursor (not JSON)", () => {
    const invalidCursor = Buffer.from("not-json", "utf-8").toString("base64url");
    expect(() => decodeCursor(invalidCursor)).toThrow();
  });

  it("should preserve millisecond precision", () => {
    const original = {
      createdAt: new Date("2024-01-15T10:30:45.123Z"),
      id: "clx9abc123def",
    };

    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.ts).toBe("2024-01-15T10:30:45.123Z");
  });

  it("should handle different timezones (all stored as UTC ISO)", () => {
    // Date constructor normalizes to UTC
    const original = {
      createdAt: new Date("2024-01-15T10:30:00.000Z"),
      id: "clx9abc123def",
    };

    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    // Should always be in ISO UTC format (ending with Z)
    expect(decoded.ts).toMatch(/Z$/);
    expect(decoded.ts).toBe("2024-01-15T10:30:00.000Z");
  });
});
