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
 * them names a private prefix other than xprv or checks the multisig version
 * bytes. In the 2026-11-16 critical mutation report every mutant of the private
 * prefix set except xprv survived, each after running about 5,500 covering
 * tests. These cases fail fast on those mutants.
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
