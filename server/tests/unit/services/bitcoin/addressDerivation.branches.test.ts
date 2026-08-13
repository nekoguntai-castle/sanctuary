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
import bip32 from '../../../../src/services/bitcoin/bip32';
import {
  convertToStandardXpub,
  convertXpubToFormat,
  deriveRelativeAddress,
  deriveAddressFromDescriptor,
  parseDescriptor,
  validateXpub,
} from '../../../../src/services/bitcoin/addressDerivation';
import { deriveAddressFromParsedDescriptor } from
  '../../../../src/services/bitcoin/addressDerivation/descriptorDerivation';
import { deriveRelativeMultisigAddress as deriveMultisigAddress } from
  '../../../../src/services/bitcoin/addressDerivation/multisigDerivation';
import { testXpubs } from '../../../fixtures/bitcoin';

bitcoin.initEccLib(ecc);

const bip48Descriptor = (
  scriptComponent: 1 | 2,
  suffix = '0/*',
): string => {
  const keys = [21, 22].map((seedByte, index) => {
    const xpub = bip32.fromSeed(Buffer.alloc(32, seedByte), bitcoin.networks.testnet)
      .deriveHardened(48)
      .deriveHardened(1)
      .deriveHardened(0)
      .deriveHardened(scriptComponent)
      .neutered()
      .toBase58();
    return `[${index === 0 ? 'aabbccdd' : '11223344'}/48h/1h/0h/${scriptComponent}h]${xpub}/${suffix}`;
  });
  const inner = `sortedmulti(1,${keys.join(',')})`;
  return scriptComponent === 2 ? `wsh(${inner})` : `sh(wsh(${inner}))`;
};

describe('Address Derivation Service additional branch coverage', () => {
  it('rejects invalid child indexes before reading or deriving the account xpub', () => {
    const fromBase58 = vi.fn();
    expect(() => deriveRelativeAddress(
      testXpubs.testnet.bip84,
      0,
      { network: 'testnet' } as never,
      { fromBase58 },
    )).toThrow(/coordinate branch/i);
    expect(() => deriveRelativeAddress(
      testXpubs.testnet.bip84,
      0,
      undefined as never,
      { fromBase58 },
    )).toThrow(/options are required/i);
    expect(() => deriveRelativeAddress(
      testXpubs.testnet.bip84,
      0,
      {
        scriptType: 'native_segwit',
        network: 'testnet',
        branch: 0,
        change: true,
      } as never,
      { fromBase58 },
    )).toThrow(/conflicting.*branch/i);
    for (const index of [-1, 0.5, 0x80000000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => deriveRelativeAddress(
        testXpubs.testnet.bip84,
        index,
        { scriptType: 'native_segwit', network: 'testnet', branch: 0 },
        { fromBase58 },
      )).toThrow(/coordinate index/i);
    }
    expect(fromBase58).not.toHaveBeenCalled();
    expect(() => deriveRelativeAddress(
      testXpubs.testnet.bip84,
      0,
      { scriptType: 'native_segwit', network: 'testnet', change: 'false' as unknown as boolean },
      { fromBase58 },
    )).toThrow(/coordinate branch/i);
    expect(fromBase58).not.toHaveBeenCalled();
  });

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
      deriveRelativeAddress(testXpubs.testnet.bip84, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        branch: 0,
      })
    ).toThrow('Failed to generate address');
  });

  it('throws when nested segwit address generation returns no address', () => {
    paymentMocks.p2sh = () => ({ address: undefined });
    expect(() =>
      deriveRelativeAddress(testXpubs.testnet.bip84, 0, {
        scriptType: 'nested_segwit',
        network: 'testnet',
        branch: 0,
      })
    ).toThrow('Failed to generate address');
  });

  it('throws when taproot address generation returns no address', () => {
    paymentMocks.p2tr = () => ({ address: undefined });
    expect(() =>
      deriveRelativeAddress(testXpubs.testnet.bip84, 0, {
        scriptType: 'taproot',
        network: 'testnet',
        branch: 0,
      })
    ).toThrow('Failed to generate address');
  });

  it('throws when legacy address generation returns no address', () => {
    paymentMocks.p2pkh = () => ({ address: undefined });
    expect(() =>
      deriveRelativeAddress(testXpubs.testnet.bip84, 0, {
        scriptType: 'legacy',
        network: 'testnet',
        branch: 0,
      })
    ).toThrow('Failed to generate address');
  });

  it('throws when xpub derivation yields no public key', () => {
    const fakeNode: any = {
      publicKey: undefined,
      derive: vi.fn(() => fakeNode),
    };

    expect(() =>
      deriveRelativeAddress(
        testXpubs.testnet.bip84,
        0,
        {
          scriptType: 'native_segwit',
          network: 'testnet',
          branch: 0,
        },
        { fromBase58: () => fakeNode }
      )
    ).toThrow('Failed to derive public key');
  });

  it('throws when multisig P2WSH address generation returns no address', () => {
    const descriptor = bip48Descriptor(2);
    paymentMocks.p2wsh = () => ({ address: undefined });
    expect(() =>
      deriveAddressFromDescriptor(descriptor, 0, { network: 'testnet' })
    ).toThrow('Failed to generate P2WSH address');
  });

  it('throws when nested multisig P2SH-P2WSH address generation returns no address', () => {
    const descriptor = bip48Descriptor(1);
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
    expect(() => parseDescriptor('wpkh([d34db33f/84h/0h/0h])')).toThrow('Invalid descriptor key expression');
  });

  it('rejects a descriptor whose derivation suffix is omitted', () => {
    const descriptor = `wpkh([d34db33f/84h/0h/0h]${testXpubs.mainnet.bip44})`;
    expect(() => parseDescriptor(descriptor)).toThrow('Invalid descriptor key expression');
  });

  it('rejects a descriptor whose derivation suffix is empty', () => {
    const descriptor = `wpkh(${testXpubs.mainnet.bip44}/)`;
    expect(() => parseDescriptor(descriptor)).toThrow('Invalid descriptor key expression');
  });

  it('rejects a noncanonical origin even when it repeats xpub-shaped text', () => {
    const xpub = testXpubs.mainnet.bip44;
    const descriptor = `wpkh([d34db33f/84h/${xpub}/0h]${xpub}/1/*)`;
    expect(() => parseDescriptor(descriptor)).toThrow('canonical account path');
  });

  it('rejects no-origin single-sig descriptors', () => {
    const descriptor = `wpkh(${testXpubs.mainnet.bip44}/1/*)`;
    expect(() => parseDescriptor(descriptor)).toThrow('Invalid descriptor key expression');
  });

  it('throws when multisig descriptor has invalid quorum syntax', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `wsh(sortedmulti(x,[aabbccdd/84h/1h/0h]${tpub}/0/*))`;
    expect(() => parseDescriptor(descriptor)).toThrow('Multisig quorum must be a positive integer');
  });

  it('throws when multisig descriptor contains no parseable keys', () => {
    expect(() => parseDescriptor('wsh(sortedmulti(2,notakey,also_not_a_key))')).toThrow(
      'Invalid descriptor key expression'
    );
  });

  it('rejects bare multisig xpubs', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `wsh(sortedmulti(2,${tpub},${tpub}))`;
    expect(() => parseDescriptor(descriptor)).toThrow('Invalid descriptor key expression');
  });

  it('throws for unsupported script type at runtime', () => {
    const tpub = testXpubs.testnet.bip84;
    expect(() =>
      deriveRelativeAddress(tpub, 0, {
        scriptType: 'unsupported' as any,
        network: 'testnet',
        branch: 0,
      })
    ).toThrow('Unsupported script type');
  });

  it('requires the requested branch to match the explicit fixed descriptor branch', () => {
    const receiveDescriptor = bip48Descriptor(2, '0/*');
    const changeDescriptor = bip48Descriptor(2, '1/*');

    expect(() => deriveAddressFromDescriptor(
      receiveDescriptor,
      2,
      { network: 'testnet', change: true },
    )).toThrow('descriptor branch 0 does not match requested branch 1');
    expect(() => deriveAddressFromDescriptor(
      changeDescriptor,
      2,
      { network: 'testnet', change: false },
    )).toThrow('descriptor branch 1 does not match requested branch 0');

    const receive = deriveAddressFromDescriptor(receiveDescriptor, 2, { network: 'testnet', change: false });
    const change = deriveAddressFromDescriptor(changeDescriptor, 2, { network: 'testnet', change: true });

    expect(receive.address).not.toBe(change.address);
    expect(receive.derivationPath).toContain('/0/2');
    expect(change.derivationPath).toContain('/1/2');
  });

  it.each(['*', '0//*', '<2;3>/*'])(
    'rejects unsupported multisig derivation suffix %s',
    suffix => {
      expect(() => deriveAddressFromDescriptor(
        bip48Descriptor(2, suffix),
        1,
        { network: 'testnet' },
      )).toThrow('Descriptor key paths must end');
    },
  );

  it('rejects a pre-parsed multisig path with multiple wildcards', () => {
    const derivedIndexes: number[] = [];
    const fakeNode: any = {
      publicKey: Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
      derive: vi.fn((idx: number) => {
        derivedIndexes.push(idx);
        return fakeNode;
      }),
    };

    expect(() => deriveAddressFromParsedDescriptor({
        type: 'wsh-sortedmulti',
        quorum: 1,
        keys: [
          {
            fingerprint: 'aabbccdd',
            accountPath: "84'/1'/0'",
            xpub: testXpubs.testnet.bip84,
            derivationPath: '0/*/*',
          },
        ],
      },
      4,
      { network: 'testnet', change: true },
      { fromBase58: () => fakeNode }
    )).toThrow('Descriptor requires an explicit fixed branch wildcard');

    expect(derivedIndexes).toEqual([]);
  });

  it('fails closed on incomplete pre-parsed multisig policy data', () => {
    const base = {
      type: 'wsh-sortedmulti' as const,
      quorum: 1,
      keys: [{
        fingerprint: 'aabbccdd',
        accountPath: "m/48'/1'/0'/2'",
        xpub: testXpubs.testnet.bip84,
        derivationPath: '0/*',
      }],
    };

    expect(() => deriveMultisigAddress(
      { ...base, keys: [] },
      0,
      { network: 'testnet', branch: 0 },
    )).toThrow('No keys found in multisig descriptor');
    expect(() => deriveMultisigAddress(
      { ...base, quorum: undefined },
      0,
      { network: 'testnet', branch: 0 },
    )).toThrow('No quorum found in multisig descriptor');
  });

  it('rejects pre-parsed multisig suffix and child-index drift before derivation', () => {
    const parsed = {
      type: 'wsh-sortedmulti' as const,
      quorum: 1,
      keys: [{
        fingerprint: 'aabbccdd',
        accountPath: "m/48'/1'/0'/2'",
        xpub: testXpubs.testnet.bip84,
        derivationPath: 'receive/*',
      }],
    };
    const fakeNode: any = {
      publicKey: Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
      derive: vi.fn(() => fakeNode),
    };

    expect(() => deriveMultisigAddress(
      parsed,
      0,
      { network: 'testnet', branch: 0 },
      { fromBase58: () => fakeNode },
    )).toThrow('explicit fixed branch wildcard');
    expect(() => deriveMultisigAddress(
      { ...parsed, keys: [{ ...parsed.keys[0], derivationPath: '0/*' }] },
      0,
      { network: 'testnet', branch: 1 },
      { fromBase58: () => fakeNode },
    )).toThrow('descriptor branch 0 does not match requested branch 1');
    expect(() => deriveMultisigAddress(
      { ...parsed, keys: [{ ...parsed.keys[0], derivationPath: '0/*' }] },
      Number.NaN,
      { network: 'testnet', branch: 0 },
      { fromBase58: () => fakeNode },
    )).toThrow('Invalid canonical address coordinate index');
    expect(() => deriveMultisigAddress(
      { ...parsed, keys: [{ ...parsed.keys[0], derivationPath: '0/*' }] },
      0x80000000,
      { network: 'testnet', branch: 0 },
      { fromBase58: () => fakeNode },
    )).toThrow('Invalid canonical address coordinate index');
    expect(() => deriveMultisigAddress(
      { ...parsed, keys: [{ ...parsed.keys[0], accountPath: "48'/1'/0'/2'", derivationPath: '0/*' }] },
      { [Symbol.toPrimitive]: () => '' } as unknown as number,
      { network: 'testnet', branch: 0 },
      { fromBase58: () => fakeNode },
    )).toThrow('Invalid canonical address coordinate index');

    const normalized = deriveMultisigAddress(
      { ...parsed, keys: [{ ...parsed.keys[0], accountPath: "48'/1'/0'/2'", derivationPath: '0/*' }] },
      0,
      { network: 'testnet', branch: 0 },
      { fromBase58: () => fakeNode },
    );
    expect(normalized).toMatchObject({ branch: 0, index: 0 });
    expect(normalized).not.toHaveProperty('derivationPath');
  });

  it('parses the canonical multipath suffix in the compatibility descriptor shape', () => {
    const descriptor = `wpkh([aabbccdd/84h/1h/0h]${testXpubs.testnet.bip84}/<0;1>/*)`;
    expect(parseDescriptor(descriptor).path).toBe('<0;1>/*');
  });

  it('rejects a pre-parsed single-sig descriptor with no fixed branch suffix', () => {
    expect(() => deriveAddressFromParsedDescriptor({
      type: 'wpkh',
      xpub: testXpubs.testnet.bip84,
    }, 0, { network: 'testnet' })).toThrow(
      'Descriptor requires an explicit fixed branch wildcard',
    );
  });

  it('rejects a single-sig descriptor that substitutes a multisig keys array for its xpub', () => {
    expect(() => deriveAddressFromParsedDescriptor({
      type: 'wpkh',
      fingerprint: 'aabbccdd',
      accountPath: "84'/1'/0'",
      path: '0/*',
      keys: [{
        fingerprint: 'aabbccdd',
        accountPath: "84'/1'/0'",
        xpub: testXpubs.testnet.bip84,
        derivationPath: '0/*',
      }],
    }, 0, { network: 'testnet' })).toThrow('No xpub found in descriptor');
  });

  it('rejects ambiguous single-sig descriptors that also contain multisig keys', () => {
    expect(() => deriveAddressFromParsedDescriptor({
      type: 'wpkh',
      fingerprint: 'aabbccdd',
      accountPath: "84'/1'/0'",
      xpub: testXpubs.testnet.bip84,
      path: '0/*',
      keys: [{
        fingerprint: '11223344',
        accountPath: "84'/1'/0'",
        xpub: testXpubs.testnet.bip84,
        derivationPath: '0/*',
      }],
    }, 0, { network: 'testnet' })).toThrow(
      'Single-signature descriptor cannot contain multisig keys',
    );
  });

  it('never manufactures an account origin from an extended-key prefix', () => {
    const zpub = 'Zpub74omgM7ehB1aZZsx274C1CrbXjE8MSzKzijgwh4Wvhupc5UaLioFcYRi5pEtfdrJa5kSumat5xbiMWrNZuuKLqN22H72P6DrAqNQLE4dv1m';
    const result = deriveRelativeAddress(zpub, 0, {
      scriptType: 'nested_segwit',
      network: 'mainnet',
      branch: 0,
    });

    expect(result.address).toMatch(/^3/);
    expect(result).toMatchObject({ branch: 0, index: 0 });
    expect(result).not.toHaveProperty('derivationPath');
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

  it('validates lowercase native-segwit extended key variants', () => {
    const zpub = 'zpub6qUQGY8YyN3ZxYEgf8J6KCQBqQAbdSWaT9RK54L5FWTTh8na8NkCkZpYHnWt7zEwNhqd6p9Utq562cSZsqGqFE87NNsUKnyZeJ5KvbhfC8E';
    const vpub = 'vpub5Y6cjg78GGuNLsaPhmYsiw4gYX3HoQiRBiSwDaBXKUafCt9bNwWQiitDk5VZ5BVxYnQdwoTyXSs2JHRPAgjAvtbBrf8ZhDYe2jWAqvZVnsc';

    expect(validateXpub(zpub, 'mainnet')).toMatchObject({
      valid: true,
      scriptType: 'native_segwit',
    });
    expect(validateXpub(vpub, 'testnet')).toMatchObject({
      valid: true,
      scriptType: 'native_segwit',
    });
  });
});
