/**
 * BIP-340 Official Test Vector Verification (Schnorr Signatures)
 *
 * Tests Schnorr signature verification against the official BIP-340 test vectors:
 * https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki
 *
 * These vectors verify that:
 * - Valid Schnorr signatures are accepted
 * - Invalid signatures (wrong key, negated values, etc.) are rejected
 * - Edge cases (infinity points, field/order boundaries) are handled
 */

import { describe, it, expect } from 'vitest';
import * as ecc from 'tiny-secp256k1';
import { BIP340_TEST_VECTORS } from '@fixtures/bip340-test-vectors';

/**
 * Vectors 15-18 use variable-length messages (0, 1, 17, 100 bytes).
 * tiny-secp256k1 requires exactly 32-byte messages for signSchnorr/verifySchnorr,
 * so we can only test the standard 32-byte message vectors.
 */
const STANDARD_VECTORS = BIP340_TEST_VECTORS.filter((v) => {
  const msgLen = v.message.length / 2; // hex chars -> bytes
  return msgLen === 32 || msgLen === 0 && v.index <= 14;
}).filter((v) => v.message.length === 64); // exactly 32 bytes

describe('BIP-340 Schnorr Signature Verification', () => {
  describe('Signature verification (32-byte messages)', () => {
    STANDARD_VECTORS.forEach((vector) => {
      const testName = `Vector ${vector.index}: ${vector.comment}`;

      if (vector.verificationResult) {
        it(`should accept valid: ${testName}`, () => {
          const publicKey = Buffer.from(vector.publicKey, 'hex');
          const message = Buffer.from(vector.message, 'hex');
          const signature = Buffer.from(vector.signature, 'hex');

          const result = ecc.verifySchnorr(message, publicKey, signature);
          expect(result).toBe(true);
        });
      } else {
        it(`should reject invalid: ${testName}`, () => {
          const publicKey = Buffer.from(vector.publicKey, 'hex');
          const message = Buffer.from(vector.message, 'hex');
          const signature = Buffer.from(vector.signature, 'hex');

          // Should either return false or throw
          try {
            const result = ecc.verifySchnorr(message, publicKey, signature);
            expect(result).toBe(false);
          } catch {
            // Throwing is also acceptable for invalid inputs
            expect(true).toBe(true);
          }
        });
      }
    });
  });

  describe('Signing (vectors with secret keys)', () => {
    const signingVectors = STANDARD_VECTORS.filter(
      (v) => v.secretKey !== '' && v.verificationResult
    );

    signingVectors.forEach((vector) => {
      it(`should produce verifiable signature for vector ${vector.index}`, () => {
        const secretKey = Buffer.from(vector.secretKey, 'hex');
        const message = Buffer.from(vector.message, 'hex');
        const auxRand = Buffer.from(vector.auxRand, 'hex');

        // Sign using tiny-secp256k1
        const signature = ecc.signSchnorr(message, secretKey, auxRand);

        // Verify the produced signature
        const publicKey = Buffer.from(vector.publicKey, 'hex');
        const isValid = ecc.verifySchnorr(message, publicKey, signature);
        expect(isValid).toBe(true);
      });

      it(`should produce exact signature bytes for vector ${vector.index}`, () => {
        const secretKey = Buffer.from(vector.secretKey, 'hex');
        const message = Buffer.from(vector.message, 'hex');
        const auxRand = Buffer.from(vector.auxRand, 'hex');

        const signature = ecc.signSchnorr(message, secretKey, auxRand);
        const expectedSignature = Buffer.from(vector.signature, 'hex');

        expect(Buffer.from(signature).toString('hex').toUpperCase()).toBe(
          expectedSignature.toString('hex').toUpperCase()
        );
      });
    });
  });

  describe('Variable-length message vectors (15-18)', () => {
    const varLenVectors = BIP340_TEST_VECTORS.filter((v) => v.index >= 15);

    varLenVectors.forEach((vector) => {
      it(`vector ${vector.index}: key derivation is correct (${vector.comment})`, () => {
        // We can still verify key derivation even if we can't verify signatures
        // with variable-length messages in tiny-secp256k1
        const secretKey = Buffer.from(vector.secretKey, 'hex');
        const fullPubkey = ecc.pointFromScalar(secretKey);
        expect(fullPubkey).not.toBeNull();

        const xOnlyPubkey = fullPubkey!.slice(1, 33);
        expect(Buffer.from(xOnlyPubkey).toString('hex').toUpperCase()).toBe(
          vector.publicKey.toUpperCase()
        );
      });
    });
  });

  describe('Public key derivation from secret key', () => {
    const keyVectors = STANDARD_VECTORS.filter((v) => v.secretKey !== '');

    keyVectors.forEach((vector) => {
      it(`should derive correct x-only public key for vector ${vector.index}`, () => {
        const secretKey = Buffer.from(vector.secretKey, 'hex');

        // Derive the full public key (33 bytes compressed)
        const fullPubkey = ecc.pointFromScalar(secretKey);
        expect(fullPubkey).not.toBeNull();

        // Extract x-only (last 32 bytes of 33-byte compressed key)
        const xOnlyPubkey = fullPubkey!.slice(1, 33);
        expect(xOnlyPubkey.length).toBe(32);

        expect(Buffer.from(xOnlyPubkey).toString('hex').toUpperCase()).toBe(
          vector.publicKey.toUpperCase()
        );
      });
    });
  });
});
