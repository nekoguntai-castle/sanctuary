import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../../src/services/bitcoin/bip32';

vi.mock('@sanctuary/shared/constants/walletPolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('@sanctuary/shared/constants/walletPolicy')>(),
  WALLET_POLICY_REGISTRY: [],
}));

import { parseDescriptorForImport } from '../../../../../src/services/bitcoin/descriptorParser/descriptorParser';

describe('descriptor policy registry defense', () => {
  it('rejects a parsed wrapper when no canonical policy row owns it', () => {
    const xpub = bip32.fromSeed(Buffer.alloc(32, 81), bitcoin.networks.testnet)
      .derivePath("m/84'/1'/0'").neutered().toBase58();
    expect(() => parseDescriptorForImport(
      `wpkh([aabbccdd/84h/1h/0h]${xpub}/0/*)`,
    )).toThrow('Descriptor wrapper has no canonical wallet policy');
  });
});
