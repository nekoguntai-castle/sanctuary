/**
 * Buffer/Uint8Array Utilities
 *
 * Helper functions for working with Uint8Array values from bitcoinjs-lib v7,
 * which replaced Buffer with Uint8Array throughout its API.
 */

/**
 * Compare two Uint8Arrays for equality (replaces Buffer.equals)
 */
export function uint8ArrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Convert a Uint8Array to hex string (replaces Buffer.toString('hex'))
 */
export function toHex(arr: Uint8Array): string {
  return Buffer.from(arr).toString('hex');
}
