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

/**
 * Schema for the pre-auth verification resend. Credentials, not a session:
 * unverified users cannot log in, so they cannot call the authenticated resend.
 */
export const ResendPendingVerificationSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;
export type UpdateEmailInput = z.infer<typeof UpdateEmailSchema>;
export type ResendPendingVerificationInput = z.infer<typeof ResendPendingVerificationSchema>;
