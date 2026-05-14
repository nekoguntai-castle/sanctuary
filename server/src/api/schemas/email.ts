/**
 * Email Verification Schemas
 *
 * Zod validation schemas for email verification endpoints.
 */

import { z } from 'zod';
import { EmailSchema } from './common';

/**
 * Schema for verifying email with token
 */
export const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

/**
 * Schema for updating email address
 */
export const UpdateEmailSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Current password is required for security'),
});

export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;
export type UpdateEmailInput = z.infer<typeof UpdateEmailSchema>;
