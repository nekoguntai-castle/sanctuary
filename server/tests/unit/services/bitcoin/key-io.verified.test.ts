/**
 * Bitcoin Core key_io Test Vector Verification
 *
 * Tests the production recipient-address boundary against the complete pinned
 * applicable public-address and invalid-address Bitcoin Core corpora.
 *
 * Verifies that production validation correctly:
 * - Decodes every chain environment to the expected scriptPubKey
 * - Handles bech32/bech32m case insensitivity (tryCaseFlip)
 * - Rejects invalid addresses from key_io_invalid.json
 *
 */

import { describe, it, expect } from 'vitest';
import {
  KEY_IO_PUBLIC_ADDRESSES,
  KEY_IO_INVALID_ADDRESSES,
} from '@fixtures/bitcoin-core-key-io-vectors';
import {
  addressToOutputScript,
  validateAddress,
} from '../../../../src/services/bitcoin/utils';
import type { LegacyNetworkType } from '@sanctuary/shared/constants/bitcoin';

const NETWORKS_BY_CHAIN = {
  main: ['mainnet'],
  test: ['testnet3', 'testnet4', 'signet'],
  signet: ['testnet3', 'testnet4', 'signet'],
  regtest: ['regtest'],
} as const satisfies Record<string, readonly LegacyNetworkType[]>;

const NETWORKS = ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'] as const;

describe('Bitcoin Core key_io Address Verification', () => {
  describe('Complete applicable public-address corpus', () => {
    KEY_IO_PUBLIC_ADDRESSES.forEach((vector) => {
      it(`should decode ${vector.address} to correct scriptPubKey`, () => {
        for (const network of NETWORKS_BY_CHAIN[vector.chain]) {
          expect(validateAddress(vector.address, network).valid).toBe(true);
          const output = addressToOutputScript(vector.address, network);
          expect(Buffer.from(output).toString('hex')).toBe(vector.scriptPubKeyHex);
        }
      });

      if (vector.tryCaseFlip) {
        it(`should decode uppercase ${vector.address} to same scriptPubKey`, () => {
          const uppercaseAddress = vector.address.toUpperCase();
          for (const network of NETWORKS_BY_CHAIN[vector.chain]) {
            expect(validateAddress(uppercaseAddress, network).valid).toBe(true);
            const output = addressToOutputScript(uppercaseAddress, network);
            expect(Buffer.from(output).toString('hex')).toBe(vector.scriptPubKeyHex);
          }
        });
      }
    });
  });

  describe('Complete invalid-address corpus', () => {
    KEY_IO_INVALID_ADDRESSES.forEach((addr) => {
      const label = addr === '' ? '(empty string)' : addr;
      it(`should reject invalid address on every network: ${label}`, () => {
        for (const network of NETWORKS) {
          expect(validateAddress(addr, network).valid).toBe(false);
          expect(() => addressToOutputScript(addr, network)).toThrow();
        }
      });
    });
  });
});
