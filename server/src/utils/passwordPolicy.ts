/**
 * Password policy constants and pure helpers.
 *
 * Keep this module free of bcrypt/runtime hashing dependencies so schema and
 * OpenAPI code can import the policy without requiring the password utility
 * stack.
 */

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
