# Input Validation

## What

Zod schema validation for all tRPC input. Shared validators enforce field constraints (min/max length, regex patterns, URL format). tRPC automatically validates input against schemas before procedure execution.

## Where

- `src/lib/validators.ts:1-62` — All Zod schemas and type exports
- `src/lib/validators.ts:4-18` — Field-level validators (username, password, email, etc.)
- `src/lib/validators.ts:21-47` — Composite endpoint schemas
- `src/lib/validators.ts:50-53` — Pagination schema with defaults

## How It Works

### Field Validators

Reusable Zod schemas for individual fields with clear constraints:

```typescript
// src/lib/validators.ts:4-18
export const usernameSchema = z
  .string()
  .min(3)
  .max(15)
  .regex(/^[a-zA-Z0-9_]+$/);

export const passwordSchema = z.string().min(8);

export const displayNameSchema = z.string().min(1).max(50);

export const bioSchema = z.string().max(160);

export const tweetContentSchema = z.string().min(1).max(280);

export const emailSchema = z.string().email();
```

Username accepts only alphanumerics and underscores. Tweet content enforces the 280-character limit. Bio limited to 160 characters (Twitter-style constraint).

### Composite Schemas

Combine field validators for API endpoints:

```typescript
// src/lib/validators.ts:21-47
export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string(), // Don't enforce min length on login
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: bioSchema.optional(),
  avatarUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
});
```

Note: `loginSchema` uses bare `z.string()` for password (no min length check) because users might have legacy passwords or we shouldn't prevent login attempts with short passwords.

### Pagination Schema with Defaults

Standard cursor-based pagination inputs with safe defaults:

```typescript
// src/lib/validators.ts:50-53
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});
```

Limit capped at 100 to prevent DOS via oversized page requests. Defaults to 20 if not provided.

### tRPC Integration

Schemas are applied via `.input()` in tRPC procedure definitions:

```typescript
// Example from src/server/trpc/routers/auth.ts:51
register: publicProcedure.input(registerSchema).mutation(async ({ input, ctx }) => {
  // input is automatically validated and typed as RegisterInput
  const { email, username, displayName, password } = input;
  // ...
});
```

tRPC automatically rejects requests with invalid input before the mutation handler runs, returning `BAD_REQUEST` with validation error details.

### Type Exports

TypeScript types are inferred from Zod schemas for type safety:

```typescript
// src/lib/validators.ts:56-61
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetCompleteInput = z.infer<typeof resetCompleteSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
```

These types are used in tRPC procedures and client code for end-to-end type safety.

## Invariants

1. **I-VAL-1:** All tRPC procedures MUST use `.input()` with a Zod schema (no unvalidated input)
2. **I-VAL-2:** Field validators MUST be reused across composite schemas (DRY principle)
3. **I-VAL-3:** Username MUST allow only `[a-zA-Z0-9_]` characters, 3-15 length
4. **I-VAL-4:** Tweet content MUST enforce 280-character maximum
5. **I-VAL-5:** Password MUST enforce 8-character minimum on registration (not on login)
6. **I-VAL-6:** Pagination limit MUST be capped at 100 to prevent oversized responses
7. **I-VAL-7:** Optional URL fields (avatarUrl, bannerUrl) MUST validate as valid URLs when present

## Gotchas

**Login password validation asymmetry:** Registration enforces `min(8)` on passwords, but login uses bare `z.string()`. This is intentional — we don't want to prevent users from logging in if their existing password is somehow shorter than 8 characters (edge case), and attackers can't exploit this since bcrypt comparison happens regardless.

**Username regex allows underscore:** The pattern `/^[a-zA-Z0-9_]+$/` allows underscores but not hyphens or periods. This matches Twitter's username rules. The backend also has a `@[a-zA-Z0-9_]+` mention parser that relies on this pattern.

**Bio 160 char limit:** Twitter's bio limit. This is stricter than the 280-character tweet limit, reflecting Twitter's UX design.

**No `.trim()` on inputs:** Zod schemas don't call `.trim()`, so leading/trailing whitespace is preserved. This is intentional for passwords (whitespace may be part of the password) but means usernames and emails with accidental spaces will fail validation.

**Pagination default applied by Zod:** The `.default(20)` on limit means if the client omits the field, Zod injects `20`. This happens before the tRPC handler sees the input, so `input.limit` is always a number, never undefined.

**URL validation for avatarUrl/bannerUrl:** These fields use `z.string().url()`, which rejects relative paths or malformed URLs. S3 pre-signed URLs must be absolute HTTPS URLs to pass validation.

**Type safety across client/server:** `z.infer<>` types are exported so client-side code can import `RegisterInput` and get compile-time checks that match the server schema. Changes to validators automatically propagate to TypeScript types.
