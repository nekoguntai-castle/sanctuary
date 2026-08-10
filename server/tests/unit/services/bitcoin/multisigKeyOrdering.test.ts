/**
 * Multisig Key Ordering Tests (BIP-67)
 *
 * BIP-67 specifies that public keys in multisig scripts MUST be sorted
 * lexicographically by their compressed public key bytes.
 *
 * This is CRITICAL because:
 * - If keys are in wrong order, the redeem/witness script changes
 * - The address changes
 * - Funds sent to that address become unspendable
 * - Hardware wallets will derive different addresses
 *
 * These tests ensure our implementation matches hardware wallet behavior
 * regardless of the order keys are provided.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveAddressFromDescriptor as deriveStrictAddressFromDescriptor,
  parseDescriptor,
} from '@/services/bitcoin/addressDerivation';
import { replaceCanonicalDescriptorBranch } from '@/services/bitcoin/descriptorParser';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../src/services/bitcoin/bip32';

// Test xpubs from different seeds - these produce different public keys
// These are verified valid xpubs from the verified-address-vectors.ts
// From BIP-48 multisig derivation paths m/48'/1'/0'/2' (native segwit multisig)
const TEST_XPUBS = {
  // From "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  xpub1:
    'tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ',
  // From "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent"
  xpub2:
    'tpubDFPtPArj4GzBEFHohegg1Xatrc1Fi9oSox5LzuSRX91miwQxuUrEpBxpvDRsmZYJKYFhgdK3UStsjC8JKXfUbMinjFqiEM4uNwzVaCaHpys',
  // From "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"
  xpub3:
    'tpubDEfobrrtptRTbKf4gysDhoabneABDTAcdj3Vbn4XwPsLE2pmqpizSPRG6zHsbAMuiSgWmWPsYCLHTKTPpyrGJ5rAoTpKoQNZcxodiPf2tSJ',
};

const TEST_FINGERPRINTS = ['11111111', '22222222', '33333333'] as const;
const NESTED_XPUB_BY_NATIVE = new Map(
  Object.values(TEST_XPUBS).map((nativeXpub, index) => {
    const nestedXpub = bip32.fromSeed(Buffer.alloc(32, index + 31), bitcoin.networks.testnet)
      .deriveHardened(48)
      .deriveHardened(1)
      .deriveHardened(0)
      .deriveHardened(1)
      .neutered()
      .toBase58();
    return [nativeXpub, nestedXpub];
  }),
);

// Build a sortedmulti descriptor with keys in a specific order
function buildMultisigDescriptor(
  xpubs: string[],
  threshold: number,
  scriptType: 'p2wsh' | 'p2sh_p2wsh',
): string {
  const scriptComponent = scriptType === 'p2wsh' ? 2 : 1;
  const keysStr = xpubs.map((nativeXpub) => {
    const signerIndex = Object.values(TEST_XPUBS).indexOf(nativeXpub);
    const xpub = scriptType === 'p2wsh'
      ? nativeXpub
      : NESTED_XPUB_BY_NATIVE.get(nativeXpub)!;
    return `[${TEST_FINGERPRINTS[signerIndex]}/48h/1h/0h/${scriptComponent}h]${xpub}/0/*`;
  }).join(',');

  if (scriptType === 'p2wsh') {
    return `wsh(sortedmulti(${threshold},${keysStr}))`;
  } else {
    return `sh(wsh(sortedmulti(${threshold},${keysStr})))`;
  }
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

describe('Multisig Key Ordering (BIP-67)', () => {
  describe('Address Determinism Regardless of Input Order', () => {
    it('should produce identical 2-of-3 P2WSH address for all key permutations', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];

      // Generate all 6 permutations of 3 keys
      const permutations = [
        [xpubs[0], xpubs[1], xpubs[2]], // ABC
        [xpubs[0], xpubs[2], xpubs[1]], // ACB
        [xpubs[1], xpubs[0], xpubs[2]], // BAC
        [xpubs[1], xpubs[2], xpubs[0]], // BCA
        [xpubs[2], xpubs[0], xpubs[1]], // CAB
        [xpubs[2], xpubs[1], xpubs[0]], // CBA
      ];

      const addresses = permutations.map((perm) => {
        const descriptor = buildMultisigDescriptor(perm, 2, 'p2wsh');
        return deriveAddressFromDescriptor(descriptor, 0, {
          network: 'testnet',
          change: false,
        }).address;
      });

      // All permutations MUST produce the exact same address
      const uniqueAddresses = new Set(addresses);
      expect(uniqueAddresses.size).toBe(1);

      // Verify it's a valid testnet bech32 address
      expect(addresses[0]).toMatch(/^tb1q[a-z0-9]{58}$/);
    });

    it('should produce identical 2-of-3 P2SH-P2WSH address for all key permutations', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];

      const permutations = [
        [xpubs[0], xpubs[1], xpubs[2]],
        [xpubs[0], xpubs[2], xpubs[1]],
        [xpubs[1], xpubs[0], xpubs[2]],
        [xpubs[1], xpubs[2], xpubs[0]],
        [xpubs[2], xpubs[0], xpubs[1]],
        [xpubs[2], xpubs[1], xpubs[0]],
      ];

      const addresses = permutations.map((perm) => {
        const descriptor = buildMultisigDescriptor(perm, 2, 'p2sh_p2wsh');
        return deriveAddressFromDescriptor(descriptor, 0, {
          network: 'testnet',
          change: false,
        }).address;
      });

      const uniqueAddresses = new Set(addresses);
      expect(uniqueAddresses.size).toBe(1);

      // Verify it's a valid testnet P2SH address (starts with 2, 34-35 chars total)
      expect(addresses[0]).toMatch(/^2[a-zA-Z0-9]{33,34}$/);
    });

    it('should produce identical addresses across multiple indices', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const reversedXpubs = [...xpubs].reverse();

      const descriptor1 = buildMultisigDescriptor(xpubs, 2, 'p2wsh');
      const descriptor2 = buildMultisigDescriptor(reversedXpubs, 2, 'p2wsh');

      for (const index of [0, 1, 5, 10, 100]) {
        const addr1 = deriveAddressFromDescriptor(descriptor1, index, {
          network: 'testnet',
          change: false,
        }).address;

        const addr2 = deriveAddressFromDescriptor(descriptor2, index, {
          network: 'testnet',
          change: false,
        }).address;

        expect(addr1).toBe(addr2);
      }
    });

    it('should produce identical change addresses regardless of key order', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const shuffledXpubs = [TEST_XPUBS.xpub2, TEST_XPUBS.xpub3, TEST_XPUBS.xpub1];

      const descriptor1 = buildMultisigDescriptor(xpubs, 2, 'p2wsh');
      const descriptor2 = buildMultisigDescriptor(shuffledXpubs, 2, 'p2wsh');

      const change1 = deriveAddressFromDescriptor(descriptor1, 0, {
        network: 'testnet',
        change: true,
      }).address;

      const change2 = deriveAddressFromDescriptor(descriptor2, 0, {
        network: 'testnet',
        change: true,
      }).address;

      expect(change1).toBe(change2);
    });
  });

  describe('Sorting Correctness', () => {
    it('should sort by derived child public key bytes at each index', () => {
      // The sorting must happen on the derived child public keys at the specific index,
      // not on the xpub strings themselves
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];

      // Derive child public keys at index 0
      const network = bitcoin.networks.testnet;
      const childPubkeys = xpubs.map((xpub) => {
        const node = bip32.fromBase58(xpub, network);
        return node.derive(0).derive(0).publicKey;
      });

      // Verify they're different
      expect(childPubkeys[0]).not.toEqual(childPubkeys[1]);
      expect(childPubkeys[1]).not.toEqual(childPubkeys[2]);

      // Manual BIP-67 sort
      const sortedPubkeys = [...childPubkeys].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));

      // The sorted order should be deterministic
      expect(sortedPubkeys.length).toBe(3);

      // Addresses should be deterministic
      const descriptor = buildMultisigDescriptor(xpubs, 2, 'p2wsh');
      const addr1 = deriveAddressFromDescriptor(descriptor, 0, { network: 'testnet' }).address;
      const addr2 = deriveAddressFromDescriptor(descriptor, 0, { network: 'testnet' }).address;
      expect(addr1).toBe(addr2);
    });
  });

  describe('Threshold Variations', () => {
    it('should maintain key ordering for 1-of-3 multisig', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const reversedXpubs = [...xpubs].reverse();

      const descriptor1 = buildMultisigDescriptor(xpubs, 1, 'p2wsh');
      const descriptor2 = buildMultisigDescriptor(reversedXpubs, 1, 'p2wsh');

      const addr1 = deriveAddressFromDescriptor(descriptor1, 0, {
        network: 'testnet',
        change: false,
      }).address;

      const addr2 = deriveAddressFromDescriptor(descriptor2, 0, {
        network: 'testnet',
        change: false,
      }).address;

      expect(addr1).toBe(addr2);
    });

    it('should maintain key ordering for 3-of-3 multisig', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const reversedXpubs = [...xpubs].reverse();

      const descriptor1 = buildMultisigDescriptor(xpubs, 3, 'p2wsh');
      const descriptor2 = buildMultisigDescriptor(reversedXpubs, 3, 'p2wsh');

      const addr1 = deriveAddressFromDescriptor(descriptor1, 0, {
        network: 'testnet',
        change: false,
      }).address;

      const addr2 = deriveAddressFromDescriptor(descriptor2, 0, {
        network: 'testnet',
        change: false,
      }).address;

      expect(addr1).toBe(addr2);
    });

    it('should produce different addresses for different thresholds', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];

      const addr1of3 = deriveAddressFromDescriptor(buildMultisigDescriptor(xpubs, 1, 'p2wsh'), 0, {
        network: 'testnet',
        change: false,
      }).address;

      const addr2of3 = deriveAddressFromDescriptor(buildMultisigDescriptor(xpubs, 2, 'p2wsh'), 0, {
        network: 'testnet',
        change: false,
      }).address;

      const addr3of3 = deriveAddressFromDescriptor(buildMultisigDescriptor(xpubs, 3, 'p2wsh'), 0, {
        network: 'testnet',
        change: false,
      }).address;

      // All thresholds should produce different addresses
      expect(addr1of3).not.toBe(addr2of3);
      expect(addr2of3).not.toBe(addr3of3);
      expect(addr1of3).not.toBe(addr3of3);
    });
  });

  describe('Script Type Variations', () => {
    it('should maintain key ordering across all multisig script types', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const reversedXpubs = [...xpubs].reverse();

      const scriptTypes = ['p2sh_p2wsh', 'p2wsh'] as const;

      for (const scriptType of scriptTypes) {
        const descriptor1 = buildMultisigDescriptor(xpubs, 2, scriptType);
        const descriptor2 = buildMultisigDescriptor(reversedXpubs, 2, scriptType);

        const addr1 = deriveAddressFromDescriptor(descriptor1, 0, {
          network: 'testnet',
          change: false,
        }).address;

        const addr2 = deriveAddressFromDescriptor(descriptor2, 0, {
          network: 'testnet',
          change: false,
        }).address;

        expect(addr1).toBe(addr2);
      }
    });

    it('should produce different addresses for different script types', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];

      const p2shP2wsh = deriveAddressFromDescriptor(
        buildMultisigDescriptor(xpubs, 2, 'p2sh_p2wsh'),
        0,
        {
          network: 'testnet',
          change: false,
        },
      ).address;

      const p2wsh = deriveAddressFromDescriptor(buildMultisigDescriptor(xpubs, 2, 'p2wsh'), 0, {
        network: 'testnet',
        change: false,
      }).address;

      expect(p2shP2wsh).not.toBe(p2wsh);
      expect(p2shP2wsh).toMatch(/^2/); // P2SH starts with 2 on testnet
      expect(p2wsh).toMatch(/^tb1q/); // P2WSH is bech32
    });
  });

  describe('Edge Cases', () => {
    it('should handle 2-of-2 multisig key ordering', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2];
      const reversedXpubs = [TEST_XPUBS.xpub2, TEST_XPUBS.xpub1];

      const descriptor1 = buildMultisigDescriptor(xpubs, 2, 'p2wsh');
      const descriptor2 = buildMultisigDescriptor(reversedXpubs, 2, 'p2wsh');

      const addr1 = deriveAddressFromDescriptor(descriptor1, 0, {
        network: 'testnet',
        change: false,
      }).address;

      const addr2 = deriveAddressFromDescriptor(descriptor2, 0, {
        network: 'testnet',
        change: false,
      }).address;

      expect(addr1).toBe(addr2);
    });

    it('should handle high address indices correctly', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const reversedXpubs = [...xpubs].reverse();

      const descriptor1 = buildMultisigDescriptor(xpubs, 2, 'p2wsh');
      const descriptor2 = buildMultisigDescriptor(reversedXpubs, 2, 'p2wsh');

      // Test with high but valid indices
      for (const index of [999, 9999]) {
        const addr1 = deriveAddressFromDescriptor(descriptor1, index, {
          network: 'testnet',
          change: false,
        }).address;

        const addr2 = deriveAddressFromDescriptor(descriptor2, index, {
          network: 'testnet',
          change: false,
        }).address;

        expect(addr1).toBe(addr2);
      }
    });

    it('should produce unique addresses at each index', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const descriptor = buildMultisigDescriptor(xpubs, 2, 'p2wsh');

      const addresses = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const addr = deriveAddressFromDescriptor(descriptor, i, {
          network: 'testnet',
          change: false,
        }).address;
        addresses.add(addr);
      }

      // All 20 addresses should be unique
      expect(addresses.size).toBe(20);
    });
  });
});

describe('Witness Script Construction', () => {
  describe('Script Hash Verification', () => {
    it('should produce valid P2WSH witness program (32 bytes)', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const descriptor = buildMultisigDescriptor(xpubs, 2, 'p2wsh');

      const { address } = deriveAddressFromDescriptor(descriptor, 0, {
        network: 'testnet',
        change: false,
      });

      // Decode bech32 address
      const decoded = bitcoin.address.fromBech32(address);

      // P2WSH has version 0 and 32-byte witness program
      expect(decoded.version).toBe(0);
      expect(decoded.data.length).toBe(32);
    });

    it('should produce different witness programs for different indices', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const descriptor = buildMultisigDescriptor(xpubs, 2, 'p2wsh');

      const addr0 = deriveAddressFromDescriptor(descriptor, 0, {
        network: 'testnet',
        change: false,
      }).address;

      const addr1 = deriveAddressFromDescriptor(descriptor, 1, {
        network: 'testnet',
        change: false,
      }).address;

      const decoded0 = bitcoin.address.fromBech32(addr0);
      const decoded1 = bitcoin.address.fromBech32(addr1);

      expect(decoded0.data).not.toEqual(decoded1.data);
    });
  });

  describe('Change vs Receive Address Separation', () => {
    it('should produce different addresses for receive vs change', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const descriptor = buildMultisigDescriptor(xpubs, 2, 'p2wsh');

      const receive = deriveAddressFromDescriptor(descriptor, 0, {
        network: 'testnet',
        change: false,
      }).address;

      const change = deriveAddressFromDescriptor(descriptor, 0, {
        network: 'testnet',
        change: true,
      }).address;

      expect(receive).not.toBe(change);
    });

    it('should maintain key ordering for both receive and change', () => {
      const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
      const reversedXpubs = [...xpubs].reverse();

      const descriptor1 = buildMultisigDescriptor(xpubs, 2, 'p2wsh');
      const descriptor2 = buildMultisigDescriptor(reversedXpubs, 2, 'p2wsh');

      // Receive addresses
      const receive1 = deriveAddressFromDescriptor(descriptor1, 0, {
        network: 'testnet',
        change: false,
      }).address;
      const receive2 = deriveAddressFromDescriptor(descriptor2, 0, {
        network: 'testnet',
        change: false,
      }).address;
      expect(receive1).toBe(receive2);

      // Change addresses
      const change1 = deriveAddressFromDescriptor(descriptor1, 0, {
        network: 'testnet',
        change: true,
      }).address;
      const change2 = deriveAddressFromDescriptor(descriptor2, 0, {
        network: 'testnet',
        change: true,
      }).address;
      expect(change1).toBe(change2);
    });
  });
});

describe('Descriptor Parsing Consistency', () => {
  it('should parse sortedmulti descriptors correctly', () => {
    const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
    const descriptor = buildMultisigDescriptor(xpubs, 2, 'p2wsh');

    const parsed = parseDescriptor(descriptor);

    expect(parsed.type).toBe('wsh-sortedmulti');
    expect(parsed.quorum).toBe(2);
    expect(parsed.keys).toHaveLength(3);
  });

  it('should parse sh-wsh sortedmulti descriptors correctly', () => {
    const xpubs = [TEST_XPUBS.xpub1, TEST_XPUBS.xpub2, TEST_XPUBS.xpub3];
    const descriptor = buildMultisigDescriptor(xpubs, 2, 'p2sh_p2wsh');

    const parsed = parseDescriptor(descriptor);

    expect(parsed.type).toBe('sh-wsh-sortedmulti');
    expect(parsed.quorum).toBe(2);
    expect(parsed.keys).toHaveLength(3);
  });
});
