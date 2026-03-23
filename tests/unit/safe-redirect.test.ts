import { safeRedirectUrl } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("safeRedirectUrl", () => {
  it("allows valid relative paths starting with /", () => {
    expect(safeRedirectUrl("/home")).toBe("/home");
    expect(safeRedirectUrl("/profile/user123")).toBe("/profile/user123");
    expect(safeRedirectUrl("/notifications?tab=all")).toBe("/notifications?tab=all");
    expect(safeRedirectUrl("/search#results")).toBe("/search#results");
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(safeRedirectUrl("//evil.com")).toBe("/home");
    expect(safeRedirectUrl("//evil.com/path")).toBe("/home");
  });

  it("rejects absolute URLs with protocols", () => {
    expect(safeRedirectUrl("https://evil.com")).toBe("/home");
    expect(safeRedirectUrl("http://evil.com")).toBe("/home");
    expect(safeRedirectUrl("ftp://evil.com")).toBe("/home");
  });

  it("rejects javascript: URIs", () => {
    expect(safeRedirectUrl("javascript:alert(1)")).toBe("/home");
    expect(safeRedirectUrl("javascript:void(0)")).toBe("/home");
  });

  it("rejects data: URIs", () => {
    expect(safeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe("/home");
  });

  it("rejects paths not starting with /", () => {
    expect(safeRedirectUrl("home")).toBe("/home");
    expect(safeRedirectUrl("profile/user")).toBe("/home");
  });

  it("rejects URLs with colons anywhere (protocol scheme)", () => {
    expect(safeRedirectUrl("/path:with:colons")).toBe("/home");
  });

  it("returns default for null/undefined", () => {
    expect(safeRedirectUrl(null)).toBe("/home");
    expect(safeRedirectUrl(undefined)).toBe("/home");
    expect(safeRedirectUrl("")).toBe("/home");
  });

  it("accepts custom default path", () => {
    expect(safeRedirectUrl(null, "/custom")).toBe("/custom");
    expect(safeRedirectUrl("https://evil.com", "/custom")).toBe("/custom");
  });
});
