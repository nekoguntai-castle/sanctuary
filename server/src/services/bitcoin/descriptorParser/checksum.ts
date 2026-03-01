/**
 * Descriptor Checksum (BIP-380)
 *
 * Computes and validates descriptor checksums per BIP-380 specification.
 */

import { createLogger } from '../../../utils/logger';

const log = createLogger('DESCRIPTOR');

/**
 * Descriptor checksum character set (BIP-380)
 * Uses same charset as bech32 but different polynomial
 */
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Polymod function for descriptor checksum (BIP-380)
 */
function descriptorPolymod(c: bigint, val: number): bigint {
  const c0 = c >> 35n;
  c = ((c & 0x7ffffffffn) << 5n) ^ BigInt(val);
  if (c0 & 1n) c ^= 0xf5dee51989n;
  if (c0 & 2n) c ^= 0xa9fdca3312n;
  if (c0 & 4n) c ^= 0x1bab10e32dn;
  if (c0 & 8n) c ^= 0x3706b1677an;
  if (c0 & 16n) c ^= 0x644d626ffdn;
  return c;
}

/**
 * Compute descriptor checksum
 */
function computeDescriptorChecksum(descriptor: string): string {
  let c = 1n;
  let cls = 0;
  let clsCount = 0;

  for (const ch of descriptor) {
    const pos = 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM0123456789_\'()[]{}*,\\/#'.indexOf(ch);
    if (pos === -1) {
      // Invalid character for checksum computation
      return '';
    }
    c = descriptorPolymod(c, pos & 31);
    cls = cls * 3 + (pos >> 5);
    clsCount++;
    if (clsCount === 3) {
      c = descriptorPolymod(c, cls);
      cls = 0;
      clsCount = 0;
    }
  }

  if (clsCount > 0) {
    c = descriptorPolymod(c, cls);
  }

  // Finalize
  for (let i = 0; i < 8; i++) {
    c = descriptorPolymod(c, 0);
  }
  c ^= 1n;

  let checksum = '';
  for (let i = 0; i < 8; i++) {
    checksum = CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - i))) & 31n)] + checksum;
  }

  return checksum.split('').reverse().join('');
}

/**
 * Validate descriptor checksum if present
 * Returns true if no checksum or checksum is valid
 * Logs warning if checksum is invalid
 */
export function validateAndRemoveChecksum(descriptor: string): { descriptor: string; valid: boolean } {
  const checksumMatch = descriptor.match(/#([a-zA-Z0-9]{8})$/);

  if (!checksumMatch) {
    // No checksum present, that's fine
    return { descriptor: descriptor.trim(), valid: true };
  }

  const providedChecksum = checksumMatch[1].toLowerCase();
  const descriptorWithoutChecksum = descriptor.slice(0, -9).trim(); // Remove #xxxxxxxx

  const computedChecksum = computeDescriptorChecksum(descriptorWithoutChecksum);

  if (computedChecksum && computedChecksum !== providedChecksum) {
    log.warn('Descriptor checksum mismatch', {
      provided: providedChecksum,
      computed: computedChecksum,
      descriptor: descriptorWithoutChecksum.substring(0, 50) + '...',
    });
    // Still accept the descriptor but log warning
  }

  return {
    descriptor: descriptorWithoutChecksum,
    valid: !computedChecksum || computedChecksum === providedChecksum,
  };
}

/**
 * Remove checksum from descriptor if present (legacy function for compatibility)
 * Checksums are appended as #xxxxxxxx
 */
export function removeChecksum(descriptor: string): string {
  return validateAndRemoveChecksum(descriptor).descriptor;
}
