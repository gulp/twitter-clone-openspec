# Password Validation and Sanitization

## What

Password input validation using Zod schema with length constraints (8-72 characters). No Unicode normalization, control character filtering, or character set restrictions beyond length. Bcrypt hashing with cost factor 12 handles password storage.

## Where

- Validation schema: `src/lib/validators.ts:10`
- Registration: `src/server/trpc/routers/auth.ts:51-121` (uses `registerSchema`)
- Password reset: `src/server/trpc/routers/auth.ts:242-301` (uses `resetCompleteSchema`)
- Hashing: `src/server/trpc/routers/auth.ts:67, 277` (bcrypt with cost 12)

## How It Works

### Current Implementation

```typescript
export const passwordSchema = z.string().min(8).max(72); // bcrypt truncates at 72 bytes
```

**Validation steps:**
1. Input must be a string
2. Minimum length: 8 characters
3. Maximum length: 72 characters (bcrypt byte limit)
4. No other constraints applied

**Hashing:**
```typescript
const hashedPassword = await bcrypt.hash(password, 12);
```
- Cost factor: 12 (~250ms on modern hardware)
- Hardcoded in two locations (registration, password reset)
- Bcrypt internally truncates passwords at 72 bytes

### What Is NOT Validated

1. **Unicode normalization** — No NFC/NFKC normalization applied
   - "café" (NFC) vs "café" (NFD) are different strings but visually identical
   - Allows homograph attacks (e.g., Cyrillic 'а' vs Latin 'a')

2. **Control characters** — Null bytes (`\0`), newlines (`\n`), tabs (`\t`) are allowed
   - Null byte could cause truncation in some logging contexts
   - Control chars may cause issues in terminal output during debugging

3. **Character set restrictions** — Any Unicode codepoint is allowed
   - Emojis, zero-width characters, RTL marks, combining diacritics all valid
   - Could lead to confusability attacks or UX issues

4. **Whitespace handling** — Leading/trailing spaces are valid, counted toward length
   - User could register with password " password " (spaces included)
   - No trimming applied before validation or hashing

5. **Password strength** — No entropy, dictionary, or pattern checks
   - "aaaaaaaa" (8 identical characters) passes validation
   - Common passwords like "password123" are valid

### Length Validation Edge Cases

**Character vs. byte counting:**
```typescript
"hello🔥".length        // 6 (JavaScript counts UTF-16 code units)
Buffer.from("hello🔥").length // 9 bytes (UTF-8 encoding)
```

Zod's `.max(72)` checks **character length**, not byte length. Multi-byte Unicode characters (e.g., emoji) could exceed bcrypt's 72-byte limit even if character count is below 72.

**Example:**
```typescript
"🔥".repeat(36).length === 36 // true — passes max(72) check
Buffer.from("🔥".repeat(36)).length === 144 // true — exceeds 72 bytes!
```

Bcrypt will silently truncate at 72 bytes, potentially weakening the password.

## Invariants

1. **Length bounds enforced** — Password must be 8-72 characters (character-counted, not byte-counted)
2. **No plaintext storage** — Passwords always hashed before database insert
3. **Cost factor consistency** — All passwords hashed with bcrypt cost 12
4. **No normalization** — Passwords stored exactly as provided (after hashing)
5. **Case-sensitive** — "Password" and "password" are different

## Gotchas

1. **Character vs. byte length mismatch** — Multi-byte Unicode can exceed bcrypt's 72-byte limit while passing Zod's 72-character check
2. **No Unicode normalization** — Visually identical passwords may hash differently (NFC vs NFD)
3. **Whitespace is significant** — Leading/trailing spaces are part of the password
4. **No strength enforcement** — Weak passwords ("12345678", "aaaaaaaa") are valid
5. **Hardcoded cost factor** — Changing bcrypt cost requires code edits in two places (src/server/trpc/routers/auth.ts:67, 277)
6. **Login skips length validation** — `loginSchema` uses `z.string()` without min/max (src/lib/validators.ts:30); allows login with any length password
7. **Control characters allowed** — Null bytes, newlines, tabs valid; could cause logging/display issues
8. **No rate limiting on validation** — Expensive bcrypt hashing happens after validation passes; no early rejection of weak passwords
9. **Homograph attacks possible** — Cyrillic/Greek lookalike characters accepted (e.g., "раsswоrd" with Cyrillic 'а' and 'о')
10. **Zero-width characters** — Invisible Unicode (zero-width space, zero-width joiner) counted toward length but not visible

## Security Considerations

### Current Posture

**Strengths:**
- bcrypt cost 12 is reasonable for 2024 (resistant to GPU brute-force)
- 72-character maximum prevents DoS via extremely long password hashing
- 8-character minimum provides basic length enforcement
- No plaintext storage

**Weaknesses:**
- **No Unicode normalization** — Users may be unable to log in if browser/OS applies different normalization (e.g., macOS HFS+ normalizes filenames to NFD)
- **Homograph risk** — Attacker could register "admin" using Cyrillic 'а' to phish users
- **Weak password acceptance** — No dictionary checks, entropy requirements, or common password filtering
- **Silent truncation** — Bcrypt truncates at 72 bytes; multi-byte Unicode passwords may be weaker than user expects
- **Control character logging risk** — Null bytes or newlines in passwords could break structured logs if accidentally logged
- **No user feedback** — Weak passwords accepted without warning; no strength meter

### Attack Scenarios

**1. Homograph Attack**
```
Attacker registers: "аdmin@example.com" (Cyrillic 'а')
Real admin: "admin@example.com" (Latin 'a')
Visually identical in many fonts, but different users
```

**2. Normalization Confusion**
```
User registers on macOS: "café" (NFD: U+0063 U+0061 U+0066 U+0065 U+0301)
User logs in from Windows: "café" (NFC: U+0063 U+0061 U+0066 U+00E9)
→ Login fails despite typing "the same password"
```

**3. Silent Truncation**
```
User sets password: "🔥".repeat(40) + "secret"
Bcrypt sees: "🔥".repeat(18) (truncated at 72 bytes, "secret" lost)
User cannot reproduce password (doesn't know it was truncated)
```

### Recommendations (Not Implemented)

1. **Add Unicode normalization** — Apply NFC normalization before hashing:
   ```typescript
   password.normalize('NFC')
   ```

2. **Restrict character set** — Disallow control characters:
   ```typescript
   z.string().min(8).max(72).regex(/^[\x20-\x7E\u00A0-\uFFFF]+$/)
   // Allows printable ASCII + common Unicode, blocks control chars
   ```

3. **Byte-length validation** — Check byte length before bcrypt:
   ```typescript
   z.string().min(8).max(72).refine(
     (pw) => Buffer.byteLength(pw, 'utf8') <= 72,
     { message: "Password exceeds 72 bytes" }
   )
   ```

4. **Password strength meter** — Client-side zxcvbn or similar (informational only)
5. **Common password list** — Reject top 10,000 common passwords (e.g., "password123")
6. **Trim whitespace** — `.trim()` before validation to avoid accidental spaces
7. **Configurable cost** — Move bcrypt cost to environment variable

### Why Not Implemented

Per project scope (v1), password complexity rules are deferred to avoid:
- Over-engineering auth flow (YAGNI principle)
- Breaking common user expectations (many users use simple passwords)
- Adding dependencies (password strength libraries, common password lists)
- Client-side validation complexity (strength meter UX)

Current validation provides **baseline security** (length + bcrypt) while remaining simple and predictable.
