/**
 * Password Utilities
 *
 * Functions for securely hashing and verifying passwords using bcrypt
 */

import bcrypt from 'bcryptjs';
import {
  PASSWORD_POLICY,
  PASSWORD_POLICY_MESSAGES,
  getPasswordUtf8ByteLength,
} from './passwordPolicy';

const SALT_ROUNDS = 10;

export { PASSWORD_POLICY, PASSWORD_POLICY_MESSAGES, getPasswordUtf8ByteLength };

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
