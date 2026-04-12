/**
 * Auth Validation Schemas
 *
 * Zod schemas for authentication endpoints.
 */

import { z } from 'zod';
import { UsernameSchema, EmailSchema, UuidSchema } from './common';
import {
  MobileLoginRequestSchema,
  MobileLogoutRequestSchema,
  MobileRefreshTokenRequestSchema,
  MobileTwoFactorVerifyRequestSchema,
  MobileUserPreferencesRequestSchema,
} from '../../../../shared/schemas/mobileApiRequests';

// =============================================================================
// Password Validation
// =============================================================================

/** Password with strength requirements */
export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine(
    (pwd) => /[a-z]/.test(pwd),
    'Password must contain at least one lowercase letter'
  )
  .refine(
    (pwd) => /[A-Z]/.test(pwd),
    'Password must contain at least one uppercase letter'
  )
  .refine(
    (pwd) => /[0-9]/.test(pwd),
    'Password must contain at least one number'
  );

/** Password for login (no strength requirements, just not empty) */
export const LoginPasswordSchema = z.string().min(1, 'Password is required');

// =============================================================================
// Registration
// =============================================================================

export const RegisterSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  email: EmailSchema.optional(),
});

// =============================================================================
// Login
// =============================================================================

export const LoginSchema = z.object({
  ...MobileLoginRequestSchema.shape,
});

// =============================================================================
// 2FA
// =============================================================================

/** 6-digit TOTP code */
export const TotpCodeSchema = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

/** Backup code (8 alphanumeric chars) */
export const BackupCodeSchema = z.string().regex(/^[A-Z0-9]{8}$/, 'Invalid backup code format');

/** Either TOTP or backup code */
export const TwoFactorCodeSchema = z.string().min(1, 'Code is required');

export const TwoFactorVerifySchema = z.object({
  tempToken: MobileTwoFactorVerifyRequestSchema.shape.tempToken,
  code: TwoFactorCodeSchema,
});

export const TwoFactorEnableSchema = z.object({
  token: TotpCodeSchema,
});

export const TwoFactorDisableSchema = z.object({
  password: LoginPasswordSchema,
  token: TwoFactorCodeSchema,
});

export const BackupCodesRequestSchema = z.object({
  password: LoginPasswordSchema,
});

export const BackupCodesRegenerateSchema = z.object({
  password: LoginPasswordSchema,
  token: TotpCodeSchema,
});

// =============================================================================
// Password Change
// =============================================================================

export const ChangePasswordSchema = z.object({
  currentPassword: LoginPasswordSchema,
  newPassword: PasswordSchema,
});

// =============================================================================
// Token Refresh
// =============================================================================

export const RefreshTokenSchema = MobileRefreshTokenRequestSchema;

// =============================================================================
// Logout
// =============================================================================

export const LogoutSchema = MobileLogoutRequestSchema;

// =============================================================================
// Session Management
// =============================================================================

export const SessionIdParamSchema = z.object({
  id: UuidSchema,
});

// =============================================================================
// User Search
// =============================================================================

export const UserSearchQuerySchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
});

// =============================================================================
// Preferences
// =============================================================================

export const PreferencesSchema = MobileUserPreferencesRequestSchema;

// =============================================================================
// Telegram
// =============================================================================

export const TelegramChatIdSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
});

export const TelegramTestSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
});

// =============================================================================
// Type Exports
// =============================================================================

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type TwoFactorVerifyInput = z.infer<typeof TwoFactorVerifySchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type PreferencesInput = z.infer<typeof PreferencesSchema>;
