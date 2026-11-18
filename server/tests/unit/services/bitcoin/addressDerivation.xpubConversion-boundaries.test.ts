import bs58check from 'bs58check';
import { describe, expect, it } from 'vitest';

import {
  assertPublicExtendedKey,
  convertToStandardXpub,
  convertXpubToFormat,
  isPrivateExtendedKey,
} from '../../../../src/services/bitcoin/addressDerivation/xpubConversion';
import { testXpubs } from '../../../fixtures/bitcoin';

/**
 * Direct boundary tests for xpubConversion.ts.
 *
 * The address vector suites reach this module thousands of times, but none of
 * them names a private prefix other than xprv, checks the multisig version
 * bytes, or tells a pass-through guard from the conversion it skips. A mutant
 * that survives here runs about 5,500 covering tests before it is reported, so
 * every branch of the module is pinned directly in this file.
 */

const PRIVATE_PREFIXES = ['xprv', 'yprv', 'zprv', 'Yprv', 'Zprv', 'tprv', 'uprv', 'vprv', 'Uprv', 'Vprv'];
const PUBLIC_PREFIXES = ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub', 'tpub', 'upub', 'vpub', 'Upub', 'Vpub'];

// Only the four-character prefix decides the watch-only boundary, so the body
// does not need to be a valid key.
const keyWithPrefix = (prefix: string): string => `${prefix}${'1'.repeat(107)}`;

describe('xpubConversion watch-only boundary', () => {
  it.each(PRIVATE_PREFIXES)('treats %s as a private extended key', (prefix) => {
    expect(isPrivateExtendedKey(keyWithPrefix(prefix))).toBe(true);
  });

  it.each(PUBLIC_PREFIXES)('does not treat %s as a private extended key', (prefix) => {
    expect(isPrivateExtendedKey(keyWithPrefix(prefix))).toBe(false);
  });

  it.each(PRIVATE_PREFIXES)('refuses %s before any conversion', (prefix) => {
    const key = keyWithPrefix(prefix);

    expect(() => assertPublicExtendedKey(key)).toThrow('Private extended keys are not allowed');
    expect(() => convertToStandardXpub(key)).toThrow('Private extended keys are not allowed');
    expect(() => convertXpubToFormat(key, 'Zpub')).toThrow('Private extended keys are not allowed');
  });

  it.each(PUBLIC_PREFIXES)('accepts %s as public', (prefix) => {
    expect(() => assertPublicExtendedKey(keyWithPrefix(prefix))).not.toThrow();
  });
});

describe('xpubConversion SLIP-132 target version bytes', () => {
  const mainnetXpub = testXpubs.mainnet.bip44;
  const testnetTpub = testXpubs.testnet.bip84;

  it.each([
    ['Zpub', mainnetXpub, [0x02, 0xaa, 0x7e, 0xd3]],
    ['Ypub', mainnetXpub, [0x02, 0x95, 0xb4, 0x3f]],
    ['Vpub', testnetTpub, [0x02, 0x57, 0x54, 0x83]],
    ['Upub', testnetTpub, [0x02, 0x42, 0x89, 0xef]],
  ] as const)('writes the %s version and keeps the key material', (format, source, version) => {
    const converted = convertXpubToFormat(source, format);
    const decoded = Buffer.from(bs58check.decode(converted));
    const original = Buffer.from(bs58check.decode(source));

    expect(converted.slice(0, 4)).toBe(format);
    expect([...decoded.subarray(0, 4)]).toEqual([...version]);
    expect(decoded.subarray(4).equals(original.subarray(4))).toBe(true);
    expect(decoded).toHaveLength(original.length);
  });

  it.each([
    ['Zpub', 'xpub', mainnetXpub, [0x04, 0x88, 0xb2, 0x1e]],
    ['Ypub', 'xpub', mainnetXpub, [0x04, 0x88, 0xb2, 0x1e]],
    ['Vpub', 'tpub', testnetTpub, [0x04, 0x35, 0x87, 0xcf]],
    ['Upub', 'tpub', testnetTpub, [0x04, 0x35, 0x87, 0xcf]],
  ] as const)('converts %s back to %s', (format, standardPrefix, source, version) => {
    const standard = convertToStandardXpub(convertXpubToFormat(source, format));

    expect(standard).toBe(source);
    expect(standard.slice(0, 4)).toBe(standardPrefix);
    expect([...Buffer.from(bs58check.decode(standard)).subarray(0, 4)]).toEqual([...version]);
  });
});

// Re-encode a key under explicit version bytes, independently of the module
// under test.
const reversion = (key: string, version: readonly number[]): string =>
  bs58check.encode(Buffer.concat([Buffer.from(version), Buffer.from(bs58check.decode(key)).subarray(4)]));

describe('xpubConversion convertToStandardXpub', () => {
  const mainnetXpub = testXpubs.mainnet.bip44;
  const testnetTpub = testXpubs.testnet.bip84;

  // SLIP-132 version bytes for the single-sig formats, which
  // convertXpubToFormat cannot produce.
  it.each([
    ['ypub', mainnetXpub, [0x04, 0x9d, 0x7c, 0xb2]],
    ['zpub', mainnetXpub, [0x04, 0xb2, 0x47, 0x46]],
    ['upub', testnetTpub, [0x04, 0x4a, 0x52, 0x62]],
    ['vpub', testnetTpub, [0x04, 0x5f, 0x1c, 0xf6]],
  ] as const)('converts %s to the standard format', (prefix, standard, version) => {
    const slip132 = reversion(standard, version);

    expect(slip132.slice(0, 4)).toBe(prefix);
    expect(convertToStandardXpub(slip132)).toBe(standard);
  });

  it.each([
    ['xpub', mainnetXpub],
    ['tpub', testnetTpub],
  ] as const)('returns a standard %s unchanged', (_prefix, standard) => {
    expect(convertToStandardXpub(standard)).toBe(standard);
  });

  it('returns a key with an unknown prefix unchanged', () => {
    expect(convertToStandardXpub('not-an-extended-key')).toBe('not-an-extended-key');
    expect(convertToStandardXpub('')).toBe('');
  });

  it.each([
    ['a character outside the base58 alphabet', (key: string) => `zpub${'0'.repeat(key.length - 4)}`],
    ['a bad checksum', (key: string) => `${key.slice(0, -1)}${key.endsWith('1') ? '2' : '1'}`],
  ] as const)('returns a SLIP-132 key with %s unchanged', (_reason, corrupt) => {
    const corrupted = corrupt(reversion(mainnetXpub, [0x04, 0xb2, 0x47, 0x46]));

    expect(corrupted.slice(0, 4)).toBe('zpub');
    expect(() => bs58check.decode(corrupted)).toThrow();
    expect(convertToStandardXpub(corrupted)).toBe(corrupted);
    expect(convertXpubToFormat(corrupted, 'xpub')).toBe(corrupted);
  });
});

describe('xpubConversion convertXpubToFormat pass-through', () => {
  const mainnetXpub = testXpubs.mainnet.bip44;

  it('leaves a key already in the target format untouched, version bytes included', () => {
    // A neighbouring version value still encodes with the same four-character
    // prefix. Re-encoding would silently rewrite it to the canonical bytes.
    const canonical = convertXpubToFormat(mainnetXpub, 'Zpub');
    const offCanonical = reversion(mainnetXpub, [0x02, 0xaa, 0x7e, 0xd4]);

    expect(offCanonical.slice(0, 4)).toBe('Zpub');
    expect(offCanonical).not.toBe(canonical);
    expect(convertXpubToFormat(offCanonical, 'Zpub')).toBe(offCanonical);
    expect(convertXpubToFormat(canonical, 'Zpub')).toBe(canonical);
  });

  // Unreachable through the typed signature. The inherited Object members
  // matter: a plain property lookup finds them and would try to use a function
  // as version bytes.
  it.each(['zpub', 'constructor', 'toString', '__proto__'])(
    'returns the key unchanged for the unknown target format %s',
    (format) => {
      expect(convertXpubToFormat(mainnetXpub, format as never)).toBe(mainnetXpub);
    },
  );
});
