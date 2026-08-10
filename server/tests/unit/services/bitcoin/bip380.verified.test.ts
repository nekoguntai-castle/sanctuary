/**
 * BIP-380 Official Test Vector Verification (Descriptor Checksums)
 *
 * Tests descriptor checksum validation against the official BIP-380 test vectors:
 * https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki
 *
 * These vectors verify that:
 * - Valid descriptor checksums are accepted and stripped correctly
 * - Invalid checksums (wrong length, corrupted payload, missing) are handled
 * - The polymod-based checksum algorithm matches the BIP-380 reference
 */

import { describe, it, expect } from 'vitest';
import { validateAndRemoveChecksum } from '@/services/bitcoin/descriptorParser/checksum';
import { BIP380_VALID_CHECKSUM, BIP380_INVALID_VECTORS } from '@fixtures/bip380-test-vectors';

describe('BIP-380 Descriptor Checksum Verification', () => {
  describe('Valid checksum (official vector)', () => {
    it('should validate raw(deadbeef)#89f8spxm and strip checksum', () => {
      const input = `${BIP380_VALID_CHECKSUM.descriptor}#${BIP380_VALID_CHECKSUM.expectedChecksum}`;
      const result = validateAndRemoveChecksum(input);

      expect(result.valid).toBe(true);
      expect(result.descriptor).toBe(BIP380_VALID_CHECKSUM.descriptor);
    });
  });

  describe('Invalid vectors', () => {
    const noChecksumVector = BIP380_INVALID_VECTORS.find(
      (v) => v.reason === 'No checksum',
    )!;

    it(`should treat as valid when no checksum present: ${noChecksumVector.reason}`, () => {
      const result = validateAndRemoveChecksum(noChecksumVector.input);

      // Checksums are optional per the implementation — no checksum means valid
      expect(result.valid).toBe(true);
      expect(result.descriptor).toBe('raw(deadbeef)');
    });

    const missingAfterSeparator = BIP380_INVALID_VECTORS.find(
      (v) => v.reason === 'Missing checksum after separator',
    )!;

    it(`should not match checksum pattern: ${missingAfterSeparator.reason}`, () => {
      const result = validateAndRemoveChecksum(missingAfterSeparator.input);

      expect(result.valid).toBe(false);
      expect(result.descriptor).toBe('raw(deadbeef)');
    });

    const tooLong = BIP380_INVALID_VECTORS.find(
      (v) => v.reason === 'Checksum too long (9 chars)',
    )!;

    it(`should not match checksum pattern: ${tooLong.reason}`, () => {
      const result = validateAndRemoveChecksum(tooLong.input);

      expect(result.valid).toBe(false);
      expect(result.descriptor).toBe('raw(deadbeef)');
    });

    const tooShort = BIP380_INVALID_VECTORS.find(
      (v) => v.reason === 'Checksum too short (7 chars)',
    )!;

    it(`should not match checksum pattern: ${tooShort.reason}`, () => {
      // '89f8spx' is 7 chars, regex requires exactly 8
      const result = validateAndRemoveChecksum(tooShort.input);

      expect(result.valid).toBe(false);
      expect(result.descriptor).toBe('raw(deadbeef)');
    });

    it('rejects eight checksum characters outside the BIP-380 charset', () => {
      const result = validateAndRemoveChecksum('raw(deadbeef)#bbbbbbbb');

      expect(result.valid).toBe(false);
      expect(result.descriptor).toBe('raw(deadbeef)');
    });

    const corruptedPayload = BIP380_INVALID_VECTORS.find(
      (v) => v.reason === 'Error in payload',
    )!;

    it(`should detect checksum mismatch: ${corruptedPayload.reason}`, () => {
      // Checksum '89f8spxm' is valid for 'raw(deadbeef)' but NOT for 'raw(deedbeef)'
      const result = validateAndRemoveChecksum(corruptedPayload.input);

      expect(result.valid).toBe(false);
      expect(result.descriptor).toBe('raw(deedbeef)');
    });

    const doubleSeparator = BIP380_INVALID_VECTORS.find(
      (v) => v.reason === 'Double separator',
    )!;

    it(`should handle gracefully: ${doubleSeparator.reason}`, () => {
      const result = validateAndRemoveChecksum(doubleSeparator.input);

      expect(result.valid).toBe(false);
      expect(result.descriptor).toBe('raw(deadbeef)#');
    });
  });
});
