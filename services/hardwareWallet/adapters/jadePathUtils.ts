/**
 * Path utilities for Blockstream Jade.
 */

const HARDENED_OFFSET = 0x80000000;

function parseJadePathPart(part: string): number {
  const isHardened = part.endsWith("'") || part.endsWith('h');
  const index = parseInt(part.replace(/['h]$/, ''), 10);
  return isHardened ? index + HARDENED_OFFSET : index;
}

/**
 * Convert string path to array of integers for Jade.
 * Jade expects paths as array of uint32, with hardened indicated by 0x80000000.
 */
export function jadePathToArray(path: string): number[] {
  return path.replace(/^m\//, '').split('/').map(parseJadePathPart);
}
