import { z } from "zod";

// Field validators
export const usernameSchema = z
  .string()
  .min(3)
  .max(15)
  .regex(/^[a-zA-Z0-9_]+$/);

export const passwordSchema = z.string().min(8);

export const displayNameSchema = z.string().max(50);

export const bioSchema = z.string().max(160);

export const tweetContentSchema = z.string().min(1).max(280);

export const emailSchema = z.string().email();

// Composite schemas for API endpoints
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

export const resetSchema = z.object({
  token: z.string(),
  password: passwordSchema,
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: bioSchema.optional(),
  avatarUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
});

// Pagination schema
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});

// Type exports
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetInput = z.infer<typeof resetSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
