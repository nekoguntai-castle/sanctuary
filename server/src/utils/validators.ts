/**
 * Shared Validation Utilities
 *
 * Common validation functions used across routes and services.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email address format
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}
