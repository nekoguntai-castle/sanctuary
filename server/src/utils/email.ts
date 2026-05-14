/**
 * Canonicalize email values for storage and lookup.
 *
 * Sanctuary treats email addresses as case-insensitive account identifiers.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}
