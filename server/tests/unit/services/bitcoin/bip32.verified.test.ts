/**
 * BIP-32 Official Test Vector Verification
 *
 * Tests our HD key derivation against the official BIP-32 test vectors:
 * https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
 *
 * These vectors verify that:
 * - Seed → master key derivation is correct
 * - Hardened child key derivation is correct
 * - Normal child key derivation is correct
 * - Extended public key serialization matches the specification
 * - Extended private key serialization matches the specification
 */

import { describe, it, expect } from 'vitest';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { BIP32_TEST_VECTORS } from '@fixtures/bip32-test-vectors';

const bip32 = BIP32Factory(ecc);

describe('BIP-32 Official Test Vectors', () => {
  BIP32_TEST_VECTORS.forEach((vector) => {
    describe(vector.description, () => {
      const seed = Buffer.from(vector.seedHex, 'hex');
      const master = bip32.fromSeed(seed);

      vector.chains.forEach((chain) => {
        describe(`derivation path: ${chain.path}`, () => {
          it('should produce correct extended public key', () => {
            const derived = derivePath(master, chain.path);
            expect(derived.neutered().toBase58()).toBe(chain.extPub);
          });

          it('should produce correct extended private key', () => {
            const derived = derivePath(master, chain.path);
            expect(derived.toBase58()).toBe(chain.extPrv);
          });

          it('should round-trip through base58 serialization', () => {
            const derived = derivePath(master, chain.path);

            // Round-trip private key
            const restoredPriv = bip32.fromBase58(derived.toBase58());
            expect(restoredPriv.toBase58()).toBe(chain.extPrv);

            // Round-trip public key
            const restoredPub = bip32.fromBase58(derived.neutered().toBase58());
            expect(restoredPub.toBase58()).toBe(chain.extPub);
          });

          it('public key from neutered private key should match direct public derivation', () => {
            const derived = derivePath(master, chain.path);
            const fromPriv = derived.neutered().toBase58();
            const fromPub = bip32.fromBase58(chain.extPub).toBase58();
            expect(fromPriv).toBe(fromPub);
          });
        });
      });
    });
  });
});

/**
 * Derive a BIP-32 key from a path string like "m/0'/1/2'/2/1000000000"
 */
function derivePath(
  master: ReturnType<typeof bip32.fromSeed>,
  path: string
): ReturnType<typeof bip32.fromSeed> {
  if (path === 'm') return master;

  const parts = path.replace('m/', '').split('/');
  let current = master;

  for (const part of parts) {
    const hardened = part.endsWith("'");
    const index = parseInt(hardened ? part.slice(0, -1) : part, 10);

    if (hardened) {
      current = current.deriveHardened(index);
    } else {
      current = current.derive(index);
    }
  }

  return current;
}
