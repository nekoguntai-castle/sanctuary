import { describe, expect, it } from 'vitest';

import {
  convertExtendedPublicKey,
  decodeAccountKeyEvidence,
  slip132VersionHex,
} from '../../scripts/verify-addresses/xpub';
import { expectedSlip132Format } from '../../scripts/verify-addresses/standardsOracle';
import { slip132FormatFor } from '../../scripts/verify-addresses/testCases';

const XPUB = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';

describe('strict SLIP-132 conversion', () => {
  it.each([
    ['legacy', 'mainnet', 'xpub'], ['legacy', 'testnet', 'tpub'],
    ['nested_segwit', 'mainnet', 'ypub'], ['nested_segwit', 'testnet', 'upub'],
    ['native_segwit', 'mainnet', 'zpub'], ['native_segwit', 'testnet', 'vpub'],
    ['taproot', 'mainnet', 'xpub'], ['taproot', 'testnet', 'tpub'],
    ['p2sh_p2wsh', 'mainnet', 'Ypub'], ['p2sh_p2wsh', 'testnet', 'Upub'],
    ['p2wsh', 'mainnet', 'Zpub'], ['p2wsh', 'testnet', 'Vpub'],
  ] as const)('pins %s/%s to %s', (scriptType, family, expected) => {
    expect(expectedSlip132Format(scriptType, family)).toBe(expected);
    expect(slip132FormatFor(scriptType, family)).toBe(expected);
  });

  it('changes only version bytes within a network family', () => {
    const zpub = convertExtendedPublicKey(XPUB, 'zpub', 'mainnet');
    const xpub = convertExtendedPublicKey(zpub, 'xpub', 'mainnet');
    expect(xpub).toBe(XPUB);
    expect(decodeAccountKeyEvidence({
      seedId: 'seed',
      masterFingerprint: 'aabbccdd',
      originPath: "m/84'/0'/0'",
      encoded: zpub,
      expectedFormat: 'zpub',
    }).versionHex).toBe(slip132VersionHex('zpub'));
  });

  it('fails closed on cross-family conversion, checksum drift, and format mismatch', () => {
    expect(() => convertExtendedPublicKey(XPUB, 'vpub', 'mainnet')).toThrow('network families');
    expect(() => convertExtendedPublicKey(`${XPUB.slice(0, -1)}1`, 'zpub')).toThrow('checksum');
    expect(() => decodeAccountKeyEvidence({
      seedId: 'seed',
      masterFingerprint: 'aabbccdd',
      originPath: "m/84'/0'/0'",
      encoded: XPUB,
      expectedFormat: 'zpub',
    })).toThrow('version mismatch');
  });
});
