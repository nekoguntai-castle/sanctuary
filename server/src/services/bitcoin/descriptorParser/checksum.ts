/**
 * Descriptor Checksum (BIP-380)
 *
 * Computes and validates descriptor checksums per BIP-380 specification.
 */

import { createLogger } from '../../../utils/logger';

const log = createLogger('BITCOIN:SVC_DESCRIPTOR');

/**
 * Descriptor checksum character set (BIP-380)
 * Uses same charset as bech32 but different polynomial
 */
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
// Exact BIP380 reference ordering: character positions are inputs to the
// polymod, so changing this string changes every checksum. The final space is
// intentional and is itself a valid descriptor character.
const INPUT_CHARSET = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";

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
export function computeDescriptorChecksum(descriptor: string): string {
  let c = 1n;
  let cls = 0;
  let clsCount = 0;

  for (const ch of descriptor) {
    const pos = INPUT_CHARSET.indexOf(ch);
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
  const separatorIndex = descriptor.lastIndexOf('#');
  if (separatorIndex === -1) {
    // No checksum present, that's fine
    return { descriptor: descriptor.trim(), valid: true };
  }

  const descriptorWithoutChecksum = descriptor.slice(0, separatorIndex).trim();
  const providedChecksum = descriptor.slice(separatorIndex + 1);
  const checksumHasValidShape = (
    descriptor.indexOf('#') === separatorIndex
    && providedChecksum.length === 8
    && [...providedChecksum].every((character) => CHECKSUM_CHARSET.includes(character))
  );
  // A present checksum is recovery evidence. Malformed or uncomputable
  // evidence must fail closed; it is never equivalent to omitting a checksum.
  if (!checksumHasValidShape) {
    return { descriptor: descriptorWithoutChecksum, valid: false };
  }

  const computedChecksum = computeDescriptorChecksum(descriptorWithoutChecksum);

  if (!computedChecksum || computedChecksum !== providedChecksum) {
    log.warn('Descriptor checksum mismatch', {
      provided: providedChecksum,
      computed: computedChecksum || '<uncomputable>',
      descriptor: descriptorWithoutChecksum.substring(0, 50) + '...',
    });
    // Still accept the descriptor but log warning
  }

  return {
    descriptor: descriptorWithoutChecksum,
    valid: computedChecksum.length > 0 && computedChecksum === providedChecksum,
  };
}

/**
 * Remove checksum from descriptor if present (legacy function for compatibility)
 * Checksums are appended as #xxxxxxxx
 */
export function removeChecksum(descriptor: string): string {
  const result = validateAndRemoveChecksum(descriptor);
  if (!result.valid) {
    throw new Error('Invalid descriptor checksum');
  }
  return result.descriptor;
}
