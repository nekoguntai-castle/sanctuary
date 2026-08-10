import { describe, expect, it } from 'vitest';
import { prepareWalletImport } from '../../../../src/services/walletImport/prepareImport';
import {
  MAINNET_BIP48_SIGNERS,
  MAINNET_BIP84_DESCRIPTORS,
  TESTNET_BIP84,
} from '../wallet/descriptorTestFixtures';

describe('prepareWalletImport', () => {
  it.each([
    ['leading space', (descriptor: string) => ` ${descriptor}`],
    ['trailing space', (descriptor: string) => `${descriptor} `],
    ['trailing LF', (descriptor: string) => `${descriptor}\n`],
    ['trailing CRLF', (descriptor: string) => `${descriptor}\r\n`],
  ])('applies the same exact-token rule to descriptors with %s', (_case, mutate) => {
    const padded = mutate(MAINNET_BIP84_DESCRIPTORS.multipath);

    expect(() => prepareWalletImport({ data: padded, descriptorInput: true }))
      .toThrow('exact non-empty descriptor token');
    expect(() => prepareWalletImport({ data: padded }))
      .toThrow('exact non-empty descriptor token');
  });

  it('labels adapter-materialized descriptors as generated rather than verbatim imports', () => {
    const rows = MAINNET_BIP48_SIGNERS.slice(0, 2)
      .map(signer => `${signer.fingerprint}: ${signer.xpub}`)
      .join('\n');
    const source = [
      'Name: Adapter policy',
      'Policy: 2 of 2',
      'Sorted: true',
      "Derivation: m/48'/0'/0'/2'",
      'Format: P2WSH',
      '',
      rows,
    ].join('\n');

    const prepared = prepareWalletImport({ data: source });

    expect(prepared.format).toBe('bluewallet_text');
    expect(prepared.descriptorPolicy?.descriptorSourceKind).toBe('generated_pair');
  });

  it('prepares Coldcard JSON through the same generated-policy boundary', () => {
    const source = JSON.stringify({
      xfp: TESTNET_BIP84.fingerprint,
      chain: 'XTN',
      bip84: { xpub: TESTNET_BIP84.xpub, deriv: TESTNET_BIP84.path },
    });

    const prepared = prepareWalletImport({ data: source, network: 'testnet4' });

    expect(prepared.format).toBe('coldcard');
    expect(prepared.network).toBe('testnet4');
    expect(prepared.descriptorPolicy?.descriptorSourceKind).toBe('generated_pair');
  });

  it('rejects malformed wallet-export change evidence before parsing a policy', () => {
    const source = JSON.stringify({
      descriptor: MAINNET_BIP84_DESCRIPTORS.receive,
      changeDescriptor: 7,
    });

    expect(() => prepareWalletImport({ data: source }))
      .toThrow('Wallet export changeDescriptor must be a string');
  });

  it.each([
    ['name', { name: 'Named export' }, 'Named export'],
    ['label', { label: 'Labeled export' }, 'Labeled export'],
    ['neither', {}, undefined],
  ])('extracts suggested import names from wallet-export %s metadata', (_case, metadata, expected) => {
    const source = JSON.stringify({
      descriptor: MAINNET_BIP84_DESCRIPTORS.receive,
      changeDescriptor: MAINNET_BIP84_DESCRIPTORS.change,
      ...metadata,
    });

    expect(prepareWalletImport({ data: source }).suggestedName).toBe(expected);
  });
});
