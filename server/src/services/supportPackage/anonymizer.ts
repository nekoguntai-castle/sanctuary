/**
 * Support Package Anonymizer
 *
 * Produces deterministic pseudonyms for IDs within a single support package.
 * Same real ID always maps to the same pseudonym within one package,
 * but different packages (different salts) produce different pseudonyms.
 */

import { createHash, randomBytes } from 'crypto';

/**
 * Generate a random salt for a support package
 */
export function generateSalt(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Create an anonymization function bound to a specific salt.
 *
 * @param salt - Per-package random salt
 * @returns anonymize(category, id) → 'category-a3f2c1d8'
 */
export function createAnonymizer(salt: string): (category: string, id: string) => string {
  const cache = new Map<string, string>();

  return (category: string, id: string): string => {
    const key = `${category}:${id}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const hash = createHash('sha256')
      .update(salt + category + ':' + id)
      .digest('hex')
      .substring(0, 8);

    const pseudonym = `${category}-${hash}`;
    cache.set(key, pseudonym);
    return pseudonym;
  };
}
