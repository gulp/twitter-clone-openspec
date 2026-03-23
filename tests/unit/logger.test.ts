import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { log } from "@/lib/logger";

/**
 * Logger tests — validates sensitive data redaction.
 *
 * Per §1.18: Automatically redact password, hashedPassword, token, access_token, refresh_token
 */

describe("Logger redaction", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("should redact password field", () => {
    log.info("User login", {
      userId: "user-1",
      password: "secret123",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.password).toBe("[REDACTED]");
    expect(output.userId).toBe("user-1");
  });

  it("should redact hashedPassword field", () => {
    log.info("User created", {
      userId: "user-1",
      hashedPassword: "$2a$12$abc123...",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.hashedPassword).toBe("[REDACTED]");
    expect(output.userId).toBe("user-1");
  });

  it("should redact token field", () => {
    log.info("Reset requested", {
      email: "user@example.com",
      token: "reset-token-abc123",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.token).toBe("[REDACTED]");
    expect(output.email).toBe("user@example.com");
  });

  it("should redact access_token field", () => {
    log.info("OAuth callback", {
      userId: "user-1",
      access_token: "oauth-access-token",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.access_token).toBe("[REDACTED]");
    expect(output.userId).toBe("user-1");
  });

  it("should redact refresh_token field", () => {
    log.info("Token refresh", {
      userId: "user-1",
      refresh_token: "oauth-refresh-token",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.refresh_token).toBe("[REDACTED]");
    expect(output.userId).toBe("user-1");
  });

  it("should preserve requestId field", () => {
    log.info("Request processed", {
      requestId: "req-123",
      password: "secret",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.requestId).toBe("req-123");
    expect(output.password).toBe("[REDACTED]");
  });

  it("should preserve nested structured fields", () => {
    log.info("Complex operation", {
      requestId: "req-123",
      user: {
        id: "user-1",
        email: "user@example.com",
      },
      latencyMs: 150,
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.requestId).toBe("req-123");
    expect(output.user).toEqual({
      id: "user-1",
      email: "user@example.com",
    });
    expect(output.latencyMs).toBe(150);
  });

  it("should redact multiple sensitive fields", () => {
    log.info("Auth event", {
      password: "secret123",
      token: "reset-token",
      access_token: "oauth-token",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.password).toBe("[REDACTED]");
    expect(output.token).toBe("[REDACTED]");
    expect(output.access_token).toBe("[REDACTED]");
  });

  it("should work with log.warn", () => {
    log.warn("Rate limit warning", {
      userId: "user-1",
      password: "secret",
    });

    expect(consoleWarnSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleWarnSpy.mock.calls[0]?.[0] as string);
    expect(output.level).toBe("warn");
    expect(output.password).toBe("[REDACTED]");
  });

  it("should work with log.error", () => {
    log.error("Authentication failed", {
      email: "user@example.com",
      password: "wrong-password",
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleErrorSpy.mock.calls[0]?.[0] as string);
    expect(output.level).toBe("error");
    expect(output.password).toBe("[REDACTED]");
  });

  it("should handle logs without data fields", () => {
    log.info("Simple message");

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.msg).toBe("Simple message");
    expect(output.level).toBe("info");
    expect(output.ts).toBeDefined();
  });

  it("should include timestamp in ISO format", () => {
    log.info("Test message", { userId: "user-1" });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("should preserve non-sensitive fields when redacting", () => {
    log.info("User action", {
      userId: "user-1",
      action: "login",
      password: "secret",
      timestamp: "2024-01-15T10:30:00Z",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.userId).toBe("user-1");
    expect(output.action).toBe("login");
    expect(output.password).toBe("[REDACTED]");
    expect(output.timestamp).toBe("2024-01-15T10:30:00Z");
  });

  it("should not redact fields that are not in the sensitive list", () => {
    log.info("Safe data", {
      userId: "user-1",
      username: "alice",
      email: "alice@example.com",
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.userId).toBe("user-1");
    expect(output.username).toBe("alice");
    expect(output.email).toBe("alice@example.com");
  });

  it("should redact nested OAuth tokens in account object", () => {
    log.info("OAuth callback", {
      userId: "user-1",
      account: {
        provider: "google",
        access_token: "oauth-access-secret",
        refresh_token: "oauth-refresh-secret",
        id_token: "oauth-id-secret",
      },
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.userId).toBe("user-1");
    expect(output.account.provider).toBe("google");
    expect(output.account.access_token).toBe("[REDACTED]");
    expect(output.account.refresh_token).toBe("[REDACTED]");
    expect(output.account.id_token).toBe("[REDACTED]");
  });

  it("should redact deeply nested password fields", () => {
    log.info("Deep structure", {
      requestId: "req-123",
      nested: {
        deeply: {
          password: "super-secret",
          username: "alice",
        },
      },
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.requestId).toBe("req-123");
    expect(output.nested.deeply.password).toBe("[REDACTED]");
    expect(output.nested.deeply.username).toBe("alice");
  });

  it("should redact passwords in arrays of objects", () => {
    log.info("Batch operation", {
      users: [
        { id: "user-1", password: "secret1" },
        { id: "user-2", password: "secret2" },
      ],
    });

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
    expect(output.users).toHaveLength(2);
    expect(output.users[0].id).toBe("user-1");
    expect(output.users[0].password).toBe("[REDACTED]");
    expect(output.users[1].id).toBe("user-2");
    expect(output.users[1].password).toBe("[REDACTED]");
  });
});
