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

const REDACTED_KEYS = [
  "password",
  "hashedPassword",
  "token",
  "access_token",
  "refresh_token",
];

/**
 * Redact sensitive fields from log data
 */
function redact(data?: LogFields): LogFields | undefined {
  if (!data) return data;
  const clone = { ...data };
  for (const key of REDACTED_KEYS) {
    if (key in clone) {
      clone[key] = "[REDACTED]";
    }
  }
  return clone;
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
      }),
    ),
  warn: (msg: string, data?: LogFields) =>
    console.warn(
      JSON.stringify({
        level: "warn",
        msg,
        ...redact(data),
        ts: new Date().toISOString(),
      }),
    ),
  error: (msg: string, data?: LogFields) =>
    console.error(
      JSON.stringify({
        level: "error",
        msg,
        ...redact(data),
        ts: new Date().toISOString(),
      }),
    ),
};
