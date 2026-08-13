/**
 * Property-Based Testing for Bitcoin Address Derivation
 *
 * Uses fast-check to automatically generate test cases and find edge cases
 * that manual testing might miss.
 *
 * Property-based testing verifies invariants that should ALWAYS hold:
 * - Same inputs always produce same outputs (determinism)
 * - Addresses always have correct format for their type
 * - Different indices produce different addresses
 * - Multisig key ordering is always consistent (BIP-67)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  deriveRelativeAddress,
  deriveAddressFromDescriptor as deriveStrictAddressFromDescriptor,
} from '@/services/bitcoin/addressDerivation';
import { replaceCanonicalDescriptorBranch } from '@/services/bitcoin/descriptorParser';

// Test xpubs from verified vectors
const TEST_XPUBS = {
  mainnet: {
    xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
  },
  testnet: {
    tpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
  },
  // Multisig xpubs from different seeds
  multisig: [
    'tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ',
    'tpubDFPtPArj4GzBEFHohegg1Xatrc1Fi9oSox5LzuSRX91miwQxuUrEpBxpvDRsmZYJKYFhgdK3UStsjC8JKXfUbMinjFqiEM4uNwzVaCaHpys',
    'tpubDEfobrrtptRTbKf4gysDhoabneABDTAcdj3Vbn4XwPsLE2pmqpizSPRG6zHsbAMuiSgWmWPsYCLHTKTPpyrGJ5rAoTpKoQNZcxodiPf2tSJ',
  ],
};

describe('Property-Based Tests: Address Derivation', () => {
  describe('Determinism Properties', () => {
    it('should always produce the same address for the same inputs', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10000 }),
          fc.boolean(),
          (index, isChange) => {
            const addr1 = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index, {
              scriptType: 'native_segwit',
              network: 'testnet',
              change: isChange,
            });

            const addr2 = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index, {
              scriptType: 'native_segwit',
              network: 'testnet',
              change: isChange,
            });

            return addr1.address === addr2.address;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should produce deterministic results across multiple derivations', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
          const addresses = Array(5)
            .fill(null)
            .map(() =>
              deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index, {
                scriptType: 'native_segwit',
                network: 'testnet',
                change: false,
              }).address,
            );

          // All 5 derivations should be identical
          return addresses.every((addr) => addr === addresses[0]);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('Format Invariants', () => {
    it('native segwit testnet addresses should always start with tb1q', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index, {
            scriptType: 'native_segwit',
            network: 'testnet',
            change: false,
          });

          return addr.address.startsWith('tb1q');
        }),
        { numRuns: 100 },
      );
    });

    it('native segwit mainnet addresses should always start with bc1q', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'native_segwit',
            network: 'mainnet',
            change: false,
          });

          return addr.address.startsWith('bc1q');
        }),
        { numRuns: 100 },
      );
    });

    it('taproot mainnet addresses should always start with bc1p', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'taproot',
            network: 'mainnet',
            change: false,
          });

          return addr.address.startsWith('bc1p');
        }),
        { numRuns: 50 },
      );
    });

    it('legacy mainnet addresses should always start with 1', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'legacy',
            network: 'mainnet',
            change: false,
          });

          return addr.address.startsWith('1');
        }),
        { numRuns: 50 },
      );
    });

    it('nested segwit mainnet addresses should always start with 3', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'nested_segwit',
            network: 'mainnet',
            change: false,
          });

          return addr.address.startsWith('3');
        }),
        { numRuns: 50 },
      );
    });

    it('P2WPKH addresses should always be 42 characters (bc1q + 39)', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'native_segwit',
            network: 'mainnet',
            change: false,
          });

          return addr.address.length === 42;
        }),
        { numRuns: 50 },
      );
    });

    it('P2TR addresses should always be 62 characters (bc1p + 58)', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'taproot',
            network: 'mainnet',
            change: false,
          });

          return addr.address.length === 62;
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('Uniqueness Properties', () => {
    it('different indices should always produce different addresses', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 9999 }),
          fc.integer({ min: 1, max: 100 }),
          (baseIndex, offset) => {
            const index1 = baseIndex;
            const index2 = baseIndex + offset;

            const addr1 = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index1, {
              scriptType: 'native_segwit',
              network: 'testnet',
              change: false,
            });

            const addr2 = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index2, {
              scriptType: 'native_segwit',
              network: 'testnet',
              change: false,
            });

            return addr1.address !== addr2.address;
          },
        ),
        { numRuns: 100 },
      );
    });

    it('receive and change addresses at same index should be different', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10000 }), (index) => {
          const receive = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index, {
            scriptType: 'native_segwit',
            network: 'testnet',
            change: false,
          });

          const change = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index, {
            scriptType: 'native_segwit',
            network: 'testnet',
            change: true,
          });

          return receive.address !== change.address;
        }),
        { numRuns: 100 },
      );
    });

    it('same index with different script types should produce different addresses', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
          const native = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'native_segwit',
            network: 'mainnet',
            change: false,
          });

          const nested = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'nested_segwit',
            network: 'mainnet',
            change: false,
          });

          const legacy = deriveRelativeAddress(TEST_XPUBS.mainnet.xpub, index, {
            scriptType: 'legacy',
            network: 'mainnet',
            change: false,
          });

          return native.address !== nested.address && nested.address !== legacy.address;
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('Derivation Path Properties', () => {
    it('derivation path should always end with correct index', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index, {
            scriptType: 'native_segwit',
            network: 'testnet',
            change: false,
          });

          return addr.branch === 0 && addr.index === index && !('derivationPath' in addr);
        }),
        { numRuns: 100 },
      );
    });

    it('change derivation path should have /1/ for change', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10000 }), (index) => {
          const addr = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, index, {
            scriptType: 'native_segwit',
            network: 'testnet',
            change: true,
          });

          return addr.branch === 1 && addr.index === index && !('derivationPath' in addr);
        }),
        { numRuns: 100 },
      );
    });
  });
});

describe('Property-Based Tests: Multisig Key Ordering (BIP-67)', () => {
  // Helper to create sortedmulti descriptor
  function buildDescriptor(xpubs: string[], threshold: number): string {
    const fingerprints = ['11111111', '22222222', '33333333'];
    const keysStr = xpubs.map((xpub) => {
      const signerIndex = TEST_XPUBS.multisig.indexOf(xpub);
      return `[${fingerprints[signerIndex]}/48h/1h/0h/2h]${xpub}/0/*`;
    }).join(',');
    return `wsh(sortedmulti(${threshold},${keysStr}))`;
  }

  const deriveAddressFromDescriptor = (
    descriptor: string,
    index: number,
    options: { network: 'testnet'; change: boolean },
  ) => deriveStrictAddressFromDescriptor(
    options.change ? replaceCanonicalDescriptorBranch(descriptor, 0, 1) : descriptor,
    index,
    options,
  );

  // Helper to generate permutation of array
  function permute<T>(arr: T[], index: number): T[] {
    const result = [...arr];
    const n = arr.length;

    // Fisher-Yates shuffle with deterministic seed
    for (let i = n - 1; i > 0; i--) {
      const j = (index + i) % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  it('multisig address should be identical regardless of key order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }), // address index
        fc.integer({ min: 0, max: 100 }), // permutation seed
        (index, permSeed) => {
          const xpubs = TEST_XPUBS.multisig;
          const permutedXpubs = permute(xpubs, permSeed);

          const desc1 = buildDescriptor(xpubs, 2);
          const desc2 = buildDescriptor(permutedXpubs, 2);

          const addr1 = deriveAddressFromDescriptor(desc1, index, {
            network: 'testnet',
            change: false,
          });

          const addr2 = deriveAddressFromDescriptor(desc2, index, {
            network: 'testnet',
            change: false,
          });

          return addr1.address === addr2.address;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('multisig should produce different addresses for different indices', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        fc.integer({ min: 1, max: 100 }),
        (baseIndex, offset) => {
          const desc = buildDescriptor(TEST_XPUBS.multisig, 2);

          const addr1 = deriveAddressFromDescriptor(desc, baseIndex, {
            network: 'testnet',
            change: false,
          });

          const addr2 = deriveAddressFromDescriptor(desc, baseIndex + offset, {
            network: 'testnet',
            change: false,
          });

          return addr1.address !== addr2.address;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('multisig receive and change should be different at same index', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
        const desc = buildDescriptor(TEST_XPUBS.multisig, 2);

        const receive = deriveAddressFromDescriptor(desc, index, {
          network: 'testnet',
          change: false,
        });

        const change = deriveAddressFromDescriptor(desc, index, {
          network: 'testnet',
          change: true,
        });

        return receive.address !== change.address;
      }),
      { numRuns: 50 },
    );
  });

  it('different thresholds should produce different addresses', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (index) => {
        const desc1of3 = buildDescriptor(TEST_XPUBS.multisig, 1);
        const desc2of3 = buildDescriptor(TEST_XPUBS.multisig, 2);
        const desc3of3 = buildDescriptor(TEST_XPUBS.multisig, 3);

        const addr1 = deriveAddressFromDescriptor(desc1of3, index, {
          network: 'testnet',
          change: false,
        });

        const addr2 = deriveAddressFromDescriptor(desc2of3, index, {
          network: 'testnet',
          change: false,
        });

        const addr3 = deriveAddressFromDescriptor(desc3of3, index, {
          network: 'testnet',
          change: false,
        });

        return addr1.address !== addr2.address && addr2.address !== addr3.address;
      }),
      { numRuns: 30 },
    );
  });
});

describe('Property-Based Tests: Edge Cases', () => {
  it('should handle boundary index 0', () => {
    const addr = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, 0, {
      scriptType: 'native_segwit',
      network: 'testnet',
      change: false,
    });

    expect(addr.address).toBeDefined();
    expect(addr.address).toMatch(/^tb1q/);
  });

  it('should handle sequential indices without collision', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9900 }), (startIndex) => {
        const addresses = new Set<string>();

        for (let i = startIndex; i < startIndex + 100; i++) {
          const addr = deriveRelativeAddress(TEST_XPUBS.testnet.tpub, i, {
            scriptType: 'native_segwit',
            network: 'testnet',
            change: false,
          });
          addresses.add(addr.address);
        }

        // All 100 addresses should be unique
        return addresses.size === 100;
      }),
      { numRuns: 10 },
    );
  });
});
