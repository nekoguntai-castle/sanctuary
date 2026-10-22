/**
 * parseImportInput multisig signer bound
 *
 * Every import format converges on parseImportInput; a multisig policy with
 * more keys than Sanctuary can spend (16) must be rejected there, while the
 * 16-key maximum and single-sig imports keep parsing.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { parseImportInput } from '../../../../src/services/import';
import bip32 from '../../../../src/services/bitcoin/bip32';

const MULTISIG_PATH = "m/48'/0'/0'/2'";

function multisigKeys(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    fp: (0x20000000 + i).toString(16),
    xpub: bip32.fromSeed(Buffer.alloc(32, i + 1)).derivePath(MULTISIG_PATH).neutered().toBase58(),
  }));
}

function descriptorImport(n: number): string {
  const keys = multisigKeys(n).map((k) => `[${k.fp}/48h/0h/0h/2h]${k.xpub}/0/*`);
  return `wsh(sortedmulti(2,${keys.join(',')}))`;
}

function jsonConfigImport(n: number): string {
  return JSON.stringify({
    type: 'multi_sig',
    scriptType: 'native_segwit',
    quorum: 2,
    network: 'mainnet',
    devices: multisigKeys(n).map((k) => ({ fingerprint: k.fp, derivationPath: MULTISIG_PATH, xpub: k.xpub })),
  });
}

function blueWalletImport(n: number): string {
  const header = `Name: Big\nPolicy: 2 of ${n}\nDerivation: ${MULTISIG_PATH}\nFormat: P2WSH\nSorted: true\n\n`;
  return header + multisigKeys(n).map((k) => `${k.fp}: ${k.xpub}`).join('\n');
}

const FORMATS: Array<[string, (n: number) => string]> = [
  ['descriptor', descriptorImport],
  ['JSON config', jsonConfigImport],
  ['BlueWallet text', blueWalletImport],
];

describe('parseImportInput multisig signer bound', () => {
  it.each(FORMATS)('accepts a 16-signer %s import', (_format, build) => {
    expect(parseImportInput(build(16)).parsed.devices).toHaveLength(16);
  });

  it.each(FORMATS)('rejects a 17-signer %s import', (_format, build) => {
    expect(() => parseImportInput(build(17))).toThrow('Multisig wallets support at most 16 signers');
  });

  it('keeps accepting a single-sig import', () => {
    const xpub = bip32.fromSeed(Buffer.alloc(32, 1)).derivePath("m/84'/0'/0'").neutered().toBase58();

    expect(parseImportInput(`wpkh([20000000/84h/0h/0h]${xpub}/0/*)`).parsed.devices).toHaveLength(1);
  });
});
