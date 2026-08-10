import { describe, expect, it } from 'vitest';
import {
  HardwareWalletIdentityError,
  normalizeMasterFingerprint,
  requireMatchingMasterFingerprint,
  validateAccountDerivationPath,
  validateXpubBatch,
  validateXpubResult,
} from '../../src/services/hardwareWallet/identity';

const xpubResult = {
  xpub: 'xpub-test',
  fingerprint: 'ABCD1234',
  path: "m/84'/0'/0'",
};

describe('hardware wallet identity evidence', () => {
  it('normalizes valid master fingerprints and rejects invalid evidence', () => {
    expect(normalizeMasterFingerprint('ABCD1234')).toBe('abcd1234');
    for (const fingerprint of [undefined, '', 'abcd123', 'not-hex!', '00000000']) {
      expect(() => normalizeMasterFingerprint(fingerprint)).toThrow(HardwareWalletIdentityError);
    }
  });

  it('requires exact case-insensitive master fingerprint identity', () => {
    expect(requireMatchingMasterFingerprint('ABCD1234', 'abcd1234')).toBe('abcd1234');
    expect(() => requireMatchingMasterFingerprint('deadbeef', 'abcd1234')).toThrow(
      /fingerprint mismatch/i
    );
  });

  it('requires the exact requested path and a non-empty unmodified xpub', () => {
    expect(validateXpubResult(xpubResult, xpubResult.path, 'abcd1234')).toEqual({
      ...xpubResult,
      fingerprint: 'abcd1234',
    });
    expect(() => validateXpubResult(xpubResult, "m/86'/0'/0'", 'abcd1234')).toThrow(
      /path mismatch/i
    );
    for (const xpub of ['', ' xpub-test']) {
      expect(() => validateXpubResult({ ...xpubResult, xpub }, xpubResult.path, 'abcd1234')).toThrow(
        /invalid xpub/i
      );
    }
  });

  it('accepts recognized account paths and rejects missing, malformed, or child paths', () => {
    expect(validateAccountDerivationPath("m/84'/0'/0'")).toBe("m/84'/0'/0'");
    expect(validateAccountDerivationPath("m/48'/1'/7'/1'")).toBe("m/48'/1'/7'/1'");
    for (const path of [
      '', ' bad/path', "m/99'/0'/0'", "m/45'/0'/0'", "m/48'/0'/0'/3'",
      "m/84'/0'/0'/0", "m/84/0'/0'", "m/84'/0'/2147483648'",
    ]) {
      expect(() => validateAccountDerivationPath(path)).toThrow(/derivation path/i);
    }
  });

  it('prevalidates a homogeneous batch against connected and stored identity', () => {
    const result = validateXpubBatch(
      [xpubResult, { ...xpubResult, path: "m/86'/0'/0'" }],
      'ABCD1234',
      'abcd1234'
    );
    expect(result.fingerprint).toBe('abcd1234');
    expect(result.results.every(item => item.fingerprint === 'abcd1234')).toBe(true);

    expect(() => validateXpubBatch([], 'abcd1234')).toThrow(/did not return any xpubs/i);
    expect(() => validateXpubBatch([{ ...xpubResult, path: '' }], 'abcd1234')).toThrow(
      /derivation path/i
    );
    expect(() => validateXpubBatch([
      xpubResult,
      { ...xpubResult, fingerprint: 'deadbeef' },
    ], 'abcd1234')).toThrow(/fingerprint mismatch/i);
  });
});
