/**
 * BIP-380 Official Test Vectors (Output Script Descriptors)
 * https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki
 * DO NOT MODIFY - these are canonical Bitcoin protocol test vectors.
 */

export interface Bip380ChecksumVector {
  descriptor: string;
  expectedChecksum: string;
}

export const BIP380_VALID_CHECKSUM: Bip380ChecksumVector = {
  descriptor: 'raw(deadbeef)',
  expectedChecksum: '89f8spxm',
};

export interface Bip380InvalidVector {
  input: string;
  reason: string;
}

export const BIP380_INVALID_VECTORS: Bip380InvalidVector[] = [
  { input: 'raw(deadbeef)', reason: 'No checksum' },
  { input: 'raw(deadbeef)#', reason: 'Missing checksum after separator' },
  { input: 'raw(deadbeef)#89f8spxmx', reason: 'Checksum too long (9 chars)' },
  { input: 'raw(deadbeef)#89f8spx', reason: 'Checksum too short (7 chars)' },
  { input: 'raw(deedbeef)#89f8spxm', reason: 'Error in payload' },
  { input: 'raw(deadbeef)##89f8spxm', reason: 'Double separator' },
];
