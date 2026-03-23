# Cursor Parsing and Validation

## What

Cursor strings from clients are opaque base64url-encoded JSON payloads. Parsing involves base64url decode → JSON parse → type validation. The codebase uses three distinct patterns depending on context: Zod schema transforms (tRPC input validation), standalone parser functions (service layer), and bare decode utilities (minimal validation).

## Where

**Zod schema transforms** (tRPC routers):
- `src/server/trpc/routers/search.ts:59-79` — tweet search cursor schema
- `src/server/trpc/routers/search.ts:87-106` — user search cursor schema

**Standalone parser functions** (service layer):
- `src/server/services/feed.ts:426-437` — parseFeedCursor

**Bare decode utility** (shared lib):
- `src/lib/utils.ts:52-54` — decodeCursor (no validation)

## How It Works

### Pattern 1: Zod Schema Transform (tRPC Input Validation)

Used in routers where input validation is handled by Zod:

```typescript
// src/server/trpc/routers/search.ts:59-79
const tweetSearchCursorSchema = z
  .string()
  .optional()
  .transform((cursor) => {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
      const rank = Number(parsed.rank);
      const ts = new Date(parsed.ts);
      const id = String(parsed.id ?? "");
      if (Number.isNaN(rank) || Number.isNaN(ts.getTime()) || !id) {
        throw new Error("Invalid cursor fields");
      }
      return { rank, ts, id };
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid cursor",
      });
    }
  });
```

**Characteristics:**
- Used directly in tRPC procedure input schemas
- Converts all errors (decode, parse, validation) to `TRPCError` with `BAD_REQUEST` code
- Type validation after parsing: `Number.isNaN()` checks, empty string checks
- Returns `null` for missing cursor (optional pagination)
- Client sees: `{ code: "BAD_REQUEST", message: "Invalid cursor" }`

### Pattern 2: Standalone Parser Function (Service Layer)

Used in service functions where error handling is delegated to caller:

```typescript
// src/server/services/feed.ts:426-437
function parseFeedCursor(cursor: string): FeedCursor {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded);
    return {
      effectiveAt: new Date(parsed.effectiveAt),
      tweetId: parsed.tweetId,
    };
  } catch (error) {
    throw new Error("Invalid cursor");
  }
}
```

**Characteristics:**
- Private function within service module
- Throws generic `Error("Invalid cursor")`
- Caller (tRPC procedure) must convert to TRPCError
- Minimal validation — relies on Date constructor and property access
- Called from `homeFeed` procedure which wraps in try/catch

### Pattern 3: Bare Decode Utility (No Validation)

Used where validation is handled by caller or not needed:

```typescript
// src/lib/utils.ts:52-54
export function decodeCursor(cursor: string): CursorPayload {
  return JSON.parse(Buffer.from(cursor, "base64url").toString());
}
```

**Characteristics:**
- No error handling — caller must wrap in try/catch
- No type validation
- Used for simple generic cursors (`{ ts, id }`)
- Throws native errors: `SyntaxError` (JSON parse), `TypeError` (invalid base64url)

### Error Propagation

All patterns follow this error conversion flow:

```
Client sends invalid cursor
  ↓
Base64url decode fails OR JSON.parse fails OR type validation fails
  ↓
Pattern 1 (Zod): → TRPCError(BAD_REQUEST) → Client sees 400 + "Invalid cursor"
Pattern 2 (service): → Error → Caller converts to TRPCError → Client sees 400
Pattern 3 (bare): → native Error → Caller must handle
```

## Invariants

**I1. Base64url encoding**
All cursor strings use `base64url` encoding (URL-safe base64 without padding). Standard base64 with `+`, `/`, `=` is not supported.

**I2. JSON payload structure**
Decoded cursors are always JSON objects (never arrays, strings, or primitives). Missing fields cause validation errors in patterns 1-2.

**I3. Date field validation**
Date fields (`ts`, `effectiveAt`) are ISO-8601 strings. Invalid dates cause `new Date(str).getTime()` to return `NaN`, triggering validation failure.

**I4. Error code consistency**
All cursor parse errors exposed to clients use `TRPCError` code `BAD_REQUEST` (400). Internal service functions may use generic `Error` but must be converted by tRPC procedures.

**I5. Optional cursor semantics**
Empty/undefined cursor means "start from beginning". Zod transforms return `null` for missing cursors; procedures interpret `null` as no cursor filter.

## Gotchas

**G1. Base64url vs base64 confusion**
Standard base64 encoding (`base64` instead of `base64url`) produces `+`, `/`, `=` characters that break in URLs and cause decode failures. Always use `base64url` for cursor encoding.

**G2. Date constructor silently accepts invalid dates**
`new Date("invalid")` does not throw — it returns Invalid Date object. Must check `getTime()` for `NaN`:
```typescript
const ts = new Date(parsed.ts);
if (Number.isNaN(ts.getTime())) {
  throw new Error("Invalid date");
}
```

**G3. Missing field coercion edge cases**
`Number(undefined)` → `NaN`, `String(undefined)` → `"undefined"`. Always use nullish coalescing and validation:
```typescript
const id = String(parsed.id ?? "");
if (!id) throw new Error("Missing id");
```

**G4. Generic catch blocks hide root cause**
All three patterns use `catch` without inspecting error type. Debugging cursor issues requires logging before the catch or using source maps to trace to original error (SyntaxError for JSON, TypeError for base64url).

**G5. No cursor integrity checking**
Cursors are not signed or HMACed. Clients can craft arbitrary cursors with valid structure but semantically invalid values (e.g., future timestamps, negative follower counts). Rely on database constraints and query logic to reject invalid data, not cursor validation.

**G6. Zod transform error messages are opaque**
When Zod transform throws `TRPCError`, the original error (JSON parse syntax error, base64 decode failure) is lost. Client always sees generic "Invalid cursor". Server logs must capture original error for debugging.

**G7. Service layer Error vs TRPCError boundary**
Pattern 2 throws generic `Error` instead of `TRPCError` because service functions are decoupled from tRPC. Callers must convert:
```typescript
// Bad: service Error leaks to client as 500
const result = await parseFeedCursor(cursor);

// Good: convert to TRPCError
try {
  const result = await parseFeedCursor(cursor);
} catch (error) {
  throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid cursor" });
}
```

**G8. No partial validation**
If any field fails validation, the entire cursor is rejected. There is no fallback to default values or partial parsing. Clients cannot recover from validation errors without requesting a fresh page (cursor=undefined).
