/**
 * Shared Validation Utilities
 *
 * Common validation functions used across routes and services.
 */

import { EmailSchema } from '../validation/commonSchemas';

/**
 * Validate email address format.
 * Uses the same Zod email schema as API and service validation.
 */
export function isValidEmail(email: string): boolean {
  return EmailSchema.safeParse(email).success;
}
