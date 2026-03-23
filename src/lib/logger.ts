/**
 * Structured JSON logger with automatic redaction of sensitive fields
 * Per §1.18: Use at key boundaries, never log request bodies or sensitive data
 */

export type LogFields = {
  requestId?: string;
  route?: string;
  userId?: string;
  errorCode?: string;
  latencyMs?: number;
} & Record<string, unknown>;

const REDACTED_KEYS = ["password", "hashedPassword", "token", "access_token", "refresh_token", "id_token"];

/**
 * Redact sensitive fields from log data (deep/recursive)
 */
function redact(data?: LogFields): LogFields | undefined {
  if (!data) return data;

  function deepRedact(value: unknown): unknown {
    // Handle null/undefined
    if (value === null || value === undefined) return value;

    // Handle arrays - recursively redact each element
    if (Array.isArray(value)) {
      return value.map((item) => deepRedact(item));
    }

    // Handle objects - recursively redact nested objects and sensitive keys
    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (REDACTED_KEYS.includes(key)) {
          result[key] = "[REDACTED]";
        } else {
          result[key] = deepRedact(val);
        }
      }
      return result;
    }

    // Primitives - return as-is
    return value;
  }

  return deepRedact(data) as LogFields;
}

/**
 * Structured logger with automatic redaction
 */
export const log = {
  info: (msg: string, data?: LogFields) =>
    console.log(
      JSON.stringify({
        level: "info",
        msg,
        ...redact(data),
        ts: new Date().toISOString(),
      })
    ),
  warn: (msg: string, data?: LogFields) =>
    console.warn(
      JSON.stringify({
        level: "warn",
        msg,
        ...redact(data),
        ts: new Date().toISOString(),
      })
    ),
  error: (msg: string, data?: LogFields) =>
    console.error(
      JSON.stringify({
        level: "error",
        msg,
        ...redact(data),
        ts: new Date().toISOString(),
      })
    ),
};
