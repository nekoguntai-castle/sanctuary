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
import bip32 from '../../../../src/services/bitcoin/bip32';
import {
  BIP32_CORPUS_PROVENANCE,
  BIP32_INVALID_SERIALIZATION_VECTORS,
  BIP32_TEST_VECTORS,
} from '@fixtures/bip32-test-vectors';

describe('BIP-32 Official Test Vectors', () => {
  it('pins the literal official vector source and evidence tier', () => {
    expect(BIP32_CORPUS_PROVENANCE).toEqual({
      commit: '60f5b33b0a7be3cf09b933d97b78071d684db7d1',
      sha256: 'e5e00a8289db2f681052cf24a745320afc225e66b25d1e489a7c884d2fc7f11f',
      evidenceTier: 'literal-official-vector',
    });
  });
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

  describe('Test Vector 5 invalid extended keys', () => {
    it('contains the complete 16-row official corpus', () => {
      expect(BIP32_INVALID_SERIALIZATION_VECTORS).toHaveLength(16);
    });

    BIP32_INVALID_SERIALIZATION_VECTORS.forEach(({ serializedKey, reason }) => {
      it(`rejects ${reason}`, () => {
        expect(() => bip32.fromBase58(serializedKey)).toThrow();
      });
    });
  });

  describe('CKD index boundaries', () => {
    const master = bip32.fromSeed(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));

    it.each([
      ['first normal child', 0],
      ['last normal child', 0x7fffffff],
      ['first hardened child', 0x80000000],
      ['last hardened child', 0xffffffff],
    ])('derives the %s at uint32 index %d', (_label, index) => {
      expect(master.derive(index).index).toBe(index);
    });

    it.each([-1, 0.5, 0x100000000, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid uint32 child index: %s',
      (index) => {
        expect(() => master.derive(index)).toThrow();
      },
    );

    it('permits the full uint31 range through deriveHardened', () => {
      expect(master.deriveHardened(0).index).toBe(0x80000000);
      expect(master.deriveHardened(0x7fffffff).index).toBe(0xffffffff);
    });

    it.each([-1, 0.5, 0x80000000, 0x100000000, Number.NaN])(
      'rejects an invalid uint31 hardened index: %s',
      (index) => {
        expect(() => master.deriveHardened(index)).toThrow();
      },
    );

    it('rejects hardened CKD from an extended public key', () => {
      expect(() => master.neutered().derive(0x80000000)).toThrow();
      expect(() => master.neutered().deriveHardened(0)).toThrow();
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
