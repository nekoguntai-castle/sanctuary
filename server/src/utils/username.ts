/**
 * Canonicalize account usernames before lookup, duplicate checks, and storage.
 * Usernames are lowercase-only at rest so case variants cannot become separate
 * accounts or bypass login rate-limit buckets.
 */
export const USERNAME_POLICY = {
  minLength: 3,
  maxLength: 50,
  pattern: '^[a-zA-Z0-9_]+$',
  description: 'Letters, numbers, and underscores only. Trimmed and stored lowercase.',
} as const;

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
