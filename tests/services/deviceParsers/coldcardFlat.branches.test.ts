import { describe,expect,it } from 'vitest';
import { coldcardFlatParser } from '../../../src/services/deviceParsers/parsers/coldcardFlat';

describe('coldcardFlatParser branch coverage', () => {
  it('rejects non-flat data and partial xpub/derivation pairs', () => {
    expect(coldcardFlatParser.canParse(null)).toEqual({ detected: false, confidence: 0 });
    expect(coldcardFlatParser.canParse('not-an-object')).toEqual({ detected: false, confidence: 0 });

    expect(
      coldcardFlatParser.canParse({
        p2wsh: 'Zpub-only',
      }),
    ).toEqual({ detected: false, confidence: 0 });

    expect(
      coldcardFlatParser.canParse({
        p2sh_p2wsh: 'Ypub-only',
      }),
    ).toEqual({ detected: false, confidence: 0 });

    expect(
      coldcardFlatParser.canParse({
        p2sh: 'xpub-only',
      }),
    ).toEqual({ detected: false, confidence: 0 });
  });

  it('returns lower confidence when xfp is missing/invalid but pair is valid', () => {
    const result = coldcardFlatParser.canParse({
      xfp: 'BAD',
      p2sh: 'xpub-value',
      p2sh_deriv: "m/45'",
    });

    expect(result).toEqual({ detected: true, confidence: 83 });
  });

  it('parses priority order and derivation-path guard branches', () => {
    const p2wshPreferred = coldcardFlatParser.parse({
      xfp: 'FACEBEEF',
      p2wsh: 'zpub-high-priority',
      p2wsh_deriv: "m/48'/0'/0'/2'",
      p2sh_p2wsh: 'ypub-second',
      p2sh_p2wsh_deriv: "m/48'/0'/0'/1'",
      p2sh: 'xpub-third',
      p2sh_deriv: "m/45'",
    });

    expect(p2wshPreferred.xpub).toBe('zpub-high-priority');
    expect(p2wshPreferred.derivationPath).toBe("m/48'/0'/0'/2'");
    expect(p2wshPreferred.fingerprint).toBe('FACEBEEF');

    const legacyFallback = coldcardFlatParser.parse({
      xfp: 'AB12CD34',
      p2sh_p2wsh: 'ypub-missing-deriv',
      p2sh: 'xpub-legacy',
      p2sh_deriv: "m/45'",
    });

    expect(legacyFallback.xpub).toBe('xpub-legacy');
    expect(legacyFallback.derivationPath).toBe("m/45'");

    const nestedSegwitSelection = coldcardFlatParser.parse({
      xfp: 'AB12CD34',
      p2wsh: 'zpub-without-deriv',
      p2sh_p2wsh: 'ypub-valid',
      p2sh_p2wsh_deriv: "m/48'/0'/0'/1'",
    });

    expect(nestedSegwitSelection.xpub).toBe('ypub-valid');
    expect(nestedSegwitSelection.derivationPath).toBe("m/48'/0'/0'/1'");

    const emptyFallback = coldcardFlatParser.parse({
      p2wsh: 'zpub-without-deriv',
      p2sh_p2wsh: 'ypub-without-deriv',
      p2sh: 'xpub-without-deriv',
    });

    expect(emptyFallback).toEqual({
      xpub: '',
      fingerprint: '',
      derivationPath: '',
    });
  });
});
