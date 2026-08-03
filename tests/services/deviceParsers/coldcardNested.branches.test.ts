import { describe,expect,it } from 'vitest';
import { coldcardNestedParser } from '../../../src/services/deviceParsers/parsers/coldcardNested';

describe('coldcardNestedParser branch coverage', () => {
  it('detects nested format and confidence branch based on xfp length', () => {
    expect(coldcardNestedParser.canParse(null)).toEqual({ detected: false, confidence: 0 });
    expect(coldcardNestedParser.canParse({ unrelated: true })).toEqual({ detected: false, confidence: 0 });
    expect(
      coldcardNestedParser.canParse({
        bip84: { xpub: 'xpub84' },
      })
    ).toEqual({ detected: true, confidence: 85 });
    expect(
      coldcardNestedParser.canParse({
        xfp: 'a1b2c3d4',
        bip84: { xpub: 'xpub84' },
      })
    ).toEqual({ detected: true, confidence: 95 });
  });

  it('parses all account families with _pub precedence and default derivation fallbacks', () => {
    const parsed = coldcardNestedParser.parse({
      xfp: 'deadbeef',
      name: 'Primary Label',
      label: 'Secondary Label',
      bip84: { _pub: 'zpub84', xpub: 'xpub84' },
      bip86: { xpub: 'xpub86' },
      bip49: { xpub: 'xpub49' },
      bip44: { xpub: 'xpub44' },
      bip48_2: { xpub: 'xpub48-2' },
      bip48_1: { xpub: 'xpub48-1' },
    });

    expect(parsed.xpub).toBe('zpub84');
    expect(parsed.fingerprint).toBe('deadbeef');
    expect(parsed.derivationPath).toBe("m/84'/0'/0'");
    expect(parsed.label).toBe('Primary Label');
    expect(parsed.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ xpub: 'zpub84', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'" }),
        expect.objectContaining({ xpub: 'xpub86', purpose: 'single_sig', scriptType: 'taproot', derivationPath: "m/86'/0'/0'" }),
        expect.objectContaining({ xpub: 'xpub49', purpose: 'single_sig', scriptType: 'nested_segwit', derivationPath: "m/49'/0'/0'" }),
        expect.objectContaining({ xpub: 'xpub44', purpose: 'single_sig', scriptType: 'legacy', derivationPath: "m/44'/0'/0'" }),
        expect.objectContaining({ xpub: 'xpub48-2', purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'" }),
        expect.objectContaining({ xpub: 'xpub48-1', purpose: 'multisig', scriptType: 'nested_segwit', derivationPath: "m/48'/0'/0'/1'" }),
      ])
    );
  });

  it('prefers first available single-sig account when bip84 is missing and falls back label/fingerprint defaults', () => {
    const parsed = coldcardNestedParser.parse({
      bip86: { xpub: 'xpub86-only', deriv: "m/86'/1'/0'" },
      label: 'Fallback Label',
      xfp: '',
    });

    expect(parsed).toEqual({
      xpub: 'xpub86-only',
      fingerprint: '',
      derivationPath: "m/86'/1'/0'",
      label: 'Fallback Label',
      accounts: [
        {
          xpub: 'xpub86-only',
          derivationPath: "m/86'/1'/0'",
          purpose: 'single_sig',
          scriptType: 'taproot',
        },
      ],
    });
  });

  it('returns empty account result shape when sections exist but contain no xpub values', () => {
    const parsed = coldcardNestedParser.parse({
      bip84: {},
      bip86: {},
      bip49: {},
      bip44: {},
      bip48_1: {},
      bip48_2: {},
    });

    expect(parsed).toEqual({
      xpub: '',
      fingerprint: '',
      derivationPath: '',
      label: '',
      accounts: undefined,
    });
  });
});
