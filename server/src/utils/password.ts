/**
 * Password Utilities
 *
 * Functions for securely hashing and verifying passwords using bcrypt
 */

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export const PASSWORD_POLICY = {
  minLength: 8,
  // Bcrypt ignores input after 72 bytes, so new passwords are capped by UTF-8 bytes.
  maxUtf8Bytes: 72,
} as const;

export const PASSWORD_POLICY_MESSAGES = {
  minLength: `Password must be at least ${PASSWORD_POLICY.minLength} characters long`,
  maxUtf8Bytes: `Password must be at most ${PASSWORD_POLICY.maxUtf8Bytes} bytes when UTF-8 encoded`,
  uppercase: 'Password must contain at least one uppercase letter',
  lowercase: 'Password must contain at least one lowercase letter',
  number: 'Password must contain at least one number',
} as const;

export function getPasswordUtf8ByteLength(password: string): number {
  return Buffer.byteLength(password, 'utf8');
}

/**
 * Hash a plain text password
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(password, salt);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(PASSWORD_POLICY_MESSAGES.minLength);
  }

  if (getPasswordUtf8ByteLength(password) > PASSWORD_POLICY.maxUtf8Bytes) {
    errors.push(PASSWORD_POLICY_MESSAGES.maxUtf8Bytes);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push(PASSWORD_POLICY_MESSAGES.uppercase);
  }

  if (!/[a-z]/.test(password)) {
    errors.push(PASSWORD_POLICY_MESSAGES.lowercase);
  }

  if (!/[0-9]/.test(password)) {
    errors.push(PASSWORD_POLICY_MESSAGES.number);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
