/**
 * Canonicalize account usernames before lookup, duplicate checks, and storage.
 * Usernames are lowercase-only at rest so case variants cannot become separate
 * accounts or bypass login rate-limit buckets.
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
