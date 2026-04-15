import { afterEach, describe, expect, it, vi } from 'vitest';

const { paymentMocks } = vi.hoisted(() => ({
  paymentMocks: {
    p2wpkh: null as ((args: unknown) => unknown) | null,
    p2sh: null as ((args: unknown) => unknown) | null,
    p2tr: null as ((args: unknown) => unknown) | null,
    p2pkh: null as ((args: unknown) => unknown) | null,
    p2wsh: null as ((args: unknown) => unknown) | null,
  },
}));

vi.mock('bitcoinjs-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bitcoinjs-lib')>();
  return {
    ...actual,
    payments: {
      ...actual.payments,
      p2wpkh: (...args: unknown[]) => paymentMocks.p2wpkh ? paymentMocks.p2wpkh(args[0]) : actual.payments.p2wpkh(...args as [Parameters<typeof actual.payments.p2wpkh>[0]]),
      p2sh: (...args: unknown[]) => paymentMocks.p2sh ? paymentMocks.p2sh(args[0]) : actual.payments.p2sh(...args as [Parameters<typeof actual.payments.p2sh>[0]]),
      p2tr: (...args: unknown[]) => paymentMocks.p2tr ? paymentMocks.p2tr(args[0]) : actual.payments.p2tr(...args as [Parameters<typeof actual.payments.p2tr>[0]]),
      p2pkh: (...args: unknown[]) => paymentMocks.p2pkh ? paymentMocks.p2pkh(args[0]) : actual.payments.p2pkh(...args as [Parameters<typeof actual.payments.p2pkh>[0]]),
      p2wsh: (...args: unknown[]) => paymentMocks.p2wsh ? paymentMocks.p2wsh(args[0]) : actual.payments.p2wsh(...args as [Parameters<typeof actual.payments.p2wsh>[0]]),
    },
  };
});

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import {
  convertToStandardXpub,
  convertXpubToFormat,
  deriveAddress,
  deriveAddressFromDescriptor,
  parseDescriptor,
  validateXpub,
} from '../../../../src/services/bitcoin/addressDerivation';
import { testXpubs } from '../../../fixtures/bitcoin';

bitcoin.initEccLib(ecc);

describe('Address Derivation Service additional branch coverage', () => {
  afterEach(() => {
    paymentMocks.p2wpkh = null;
    paymentMocks.p2sh = null;
    paymentMocks.p2tr = null;
    paymentMocks.p2pkh = null;
    paymentMocks.p2wsh = null;
  });

  it('throws when native segwit address generation returns no address', () => {
    paymentMocks.p2wpkh = () => ({ address: undefined });
    expect(() =>
      deriveAddress(testXpubs.testnet.bip84, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
      })
    ).toThrow('Failed to generate address');
  });

  it('throws when nested segwit address generation returns no address', () => {
    paymentMocks.p2sh = () => ({ address: undefined });
    expect(() =>
      deriveAddress(testXpubs.testnet.bip84, 0, {
        scriptType: 'nested_segwit',
        network: 'testnet',
      })
    ).toThrow('Failed to generate address');
  });

  it('throws when taproot address generation returns no address', () => {
    paymentMocks.p2tr = () => ({ address: undefined });
    expect(() =>
      deriveAddress(testXpubs.testnet.bip84, 0, {
        scriptType: 'taproot',
        network: 'testnet',
      })
    ).toThrow('Failed to generate address');
  });

  it('throws when legacy address generation returns no address', () => {
    paymentMocks.p2pkh = () => ({ address: undefined });
    expect(() =>
      deriveAddress(testXpubs.testnet.bip84, 0, {
        scriptType: 'legacy',
        network: 'testnet',
      })
    ).toThrow('Failed to generate address');
  });

  it('throws when xpub derivation yields no public key', () => {
    const fakeNode: any = {
      publicKey: undefined,
      derive: vi.fn(() => fakeNode),
    };

    expect(() =>
      deriveAddress(
        testXpubs.testnet.bip84,
        0,
        {
          scriptType: 'native_segwit',
          network: 'testnet',
        },
        { fromBase58: () => fakeNode }
      )
    ).toThrow('Failed to derive public key');
  });

  it('throws when multisig P2WSH address generation returns no address', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `wsh(sortedmulti(1,[aabbccdd/84h/1h/0h]${tpub}/0/*))`;
    paymentMocks.p2wsh = () => ({ address: undefined });
    expect(() =>
      deriveAddressFromDescriptor(descriptor, 0, { network: 'testnet' })
    ).toThrow('Failed to generate P2WSH address');
  });

  it('throws when nested multisig P2SH-P2WSH address generation returns no address', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `sh(wsh(sortedmulti(1,[aabbccdd/84h/1h/0h]${tpub}/0/*)))`;
    paymentMocks.p2sh = () => ({ address: undefined });
    expect(() =>
      deriveAddressFromDescriptor(descriptor, 0, { network: 'testnet' })
    ).toThrow('Failed to generate P2SH-P2WSH address');
  });

  it('returns original key when convertToStandardXpub fails to decode prefixed key', () => {
    const invalidPrefixed = 'zpub-invalid-key-data';
    expect(convertToStandardXpub(invalidPrefixed)).toBe(invalidPrefixed);
  });

  it('returns original key when convertXpubToFormat receives unknown target format', () => {
    const xpub = testXpubs.mainnet.bip44;
    const result = convertXpubToFormat(xpub, 'unknown' as any);
    expect(result).toBe(xpub);
  });

  it('throws when descriptor wrapper exists but no xpub is present', () => {
    expect(() => parseDescriptor('wpkh([d34db33f/84h/0h/0h])')).toThrow('Could not parse xpub from descriptor');
  });

  it('defaults descriptor path to 0/* when derivation suffix is omitted', () => {
    const descriptor = `wpkh([d34db33f/84h/0h/0h]${testXpubs.mainnet.bip44})`;
    const parsed = parseDescriptor(descriptor);
    expect(parsed.path).toBe('0/*');
  });

  it('throws when multisig descriptor has invalid quorum syntax', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `wsh(sortedmulti(x,[aabbccdd/84h/1h/0h]${tpub}/0/*))`;
    expect(() => parseDescriptor(descriptor)).toThrow('Could not parse quorum from multisig descriptor');
  });

  it('throws when multisig descriptor contains no parseable keys', () => {
    expect(() => parseDescriptor('wsh(sortedmulti(2,notakey,also_not_a_key))')).toThrow(
      'Could not parse keys from multisig descriptor'
    );
  });

  it('uses default 0/* path for bare multisig xpubs', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `wsh(sortedmulti(2,${tpub},${tpub}))`;
    const parsed = parseDescriptor(descriptor);

    expect(parsed.keys?.[0].derivationPath).toBe('0/*');
    expect(parsed.keys?.[1].derivationPath).toBe('0/*');
  });

  it('throws for unsupported script type at runtime', () => {
    const tpub = testXpubs.testnet.bip84;
    expect(() =>
      deriveAddress(tpub, 0, {
        scriptType: 'unsupported' as any,
        network: 'testnet',
      })
    ).toThrow('Unsupported script type');
  });

  it('handles explicit change-index replacement in multisig key derivation path', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `wsh(sortedmulti(1,[aabbccdd/84h/1h/0h]${tpub}/1/*))`;

    const receive = deriveAddressFromDescriptor(descriptor, 2, { network: 'testnet', change: false });
    const change = deriveAddressFromDescriptor(descriptor, 2, { network: 'testnet', change: true });

    expect(receive.address).not.toBe(change.address);
    expect(receive.derivationPath).toContain('/0/2');
    expect(change.derivationPath).toContain('/1/2');
  });

  it('handles wildcard-only and sparse multisig derivation path segments', () => {
    const tpub = testXpubs.testnet.bip84;
    const wildcardDescriptor = `wsh(sortedmulti(1,[aabbccdd/84h/1h/0h]${tpub}/*))`;
    const sparseDescriptor = `wsh(sortedmulti(1,[aabbccdd/84h/1h/0h]${tpub}/0//*))`;
    const nonNumericSegmentDescriptor = `wsh(sortedmulti(1,[aabbccdd/84h/1h/0h]${tpub}/<2;3>/*))`;

    const wildcard = deriveAddressFromDescriptor(wildcardDescriptor, 1, { network: 'testnet', change: true });
    const sparse = deriveAddressFromDescriptor(sparseDescriptor, 1, { network: 'testnet', change: false });
    const nonNumeric = deriveAddressFromDescriptor(nonNumericSegmentDescriptor, 1, { network: 'testnet', change: false });

    expect(wildcard.address).toMatch(/^tb1q/);
    expect(sparse.address).toMatch(/^tb1q/);
    expect(nonNumeric.address).toMatch(/^tb1q/);
  });

  it('uses nested segwit account path for Zpub when nested script type is requested', () => {
    const zpub = 'Zpub74omgM7ehB1aZZsx274C1CrbXjE8MSzKzijgwh4Wvhupc5UaLioFcYRi5pEtfdrJa5kSumat5xbiMWrNZuuKLqN22H72P6DrAqNQLE4dv1m';
    const result = deriveAddress(zpub, 0, {
      scriptType: 'nested_segwit',
      network: 'mainnet',
    });

    expect(result.address).toMatch(/^3/);
    expect(result.derivationPath).toContain("m/49'/0'/0'");
  });

  it('validates uppercase and testnet native-segwit extended key variants', () => {
    const zpubUpper = convertXpubToFormat(testXpubs.mainnet.bip44, 'Zpub');
    const vpubUpper = convertXpubToFormat(testXpubs.testnet.bip84, 'Vpub');

    const mainnetResult = validateXpub(zpubUpper, 'mainnet');
    const testnetResult = validateXpub(vpubUpper, 'testnet');

    expect(mainnetResult.valid).toBe(true);
    expect(mainnetResult.scriptType).toBe('native_segwit');
    expect(testnetResult.valid).toBe(true);
    expect(testnetResult.scriptType).toBe('native_segwit');
  });
});
