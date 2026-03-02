import { beforeEach, describe, expect, it, vi } from 'vitest';
const loggerSpies = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
const parseDeviceJsonMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

vi.mock('../../../../services/deviceParsers', () => ({
  parseDeviceJson: parseDeviceJsonMock,
}));
vi.mock('../../../../services/deviceParsers/index', () => ({
  parseDeviceJson: parseDeviceJsonMock,
}));

vi.mock('@keystonehq/bc-ur-registry', () => {
  class CryptoHDKey {
    private readonly config: any;
    constructor(config: any = {}) {
      this.config = config;
    }
    getBip32Key() {
      return this.config.xpub || '';
    }
    getOrigin() {
      return this.config.origin || null;
    }
    getParentFingerprint() {
      if (this.config.throwParentFingerprint) {
        throw new Error('parent fp unavailable');
      }
      return this.config.parentFingerprint || null;
    }
  }

  class CryptoOutput {
    private readonly hdKey: any;
    constructor(hdKey: any = null) {
      this.hdKey = hdKey;
    }
    getHDKey() {
      return this.hdKey;
    }
  }

  class CryptoAccount {
    private readonly masterFingerprint: any;
    private readonly outputs: any[];
    constructor(masterFingerprint: any = null, outputs: any[] = []) {
      this.masterFingerprint = masterFingerprint;
      this.outputs = outputs;
    }
    getMasterFingerprint() {
      return this.masterFingerprint;
    }
    getOutputDescriptors() {
      return this.outputs;
    }
  }

  return { CryptoOutput, CryptoHDKey, CryptoAccount };
});

import { CryptoAccount, CryptoHDKey, CryptoOutput } from '@keystonehq/bc-ur-registry';
import {
  extractFingerprintFromHdKey,
  extractFromUrResult,
  normalizeDerivationPath,
} from '../../../../components/DeviceDetail/accounts/urHelpers';

const makePathComponent = (index: number, hardened: boolean) => ({
  getIndex: () => index,
  isHardened: () => hardened,
});

const makeOrigin = (fingerprintHex?: string, components: Array<{ getIndex: () => number; isHardened: () => boolean }> = []) => ({
  getSourceFingerprint: () => (fingerprintHex ? Buffer.from(fingerprintHex, 'hex') : Buffer.alloc(0)),
  getComponents: () => components,
});

describe('urHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseDeviceJsonMock.mockReset();
    parseDeviceJsonMock.mockReturnValue(null);
  });

  it('normalizes derivation paths across formats', () => {
    expect(normalizeDerivationPath('')).toBe('');
    expect(normalizeDerivationPath('  M/84h/0h/0h  ')).toBe("m/84'/0'/0'");
    expect(normalizeDerivationPath("84h/0h/1'")).toBe("m/84'/0'/1'");
    expect(normalizeDerivationPath("m/49h/0h/0h")).toBe("m/49'/0'/0'");
  });

  it('extracts fingerprint from origin, then parent fingerprint, then empty fallback', () => {
    const fromOrigin = new CryptoHDKey({
      origin: makeOrigin('a1b2c3d4'),
      parentFingerprint: Buffer.from('deadbeef', 'hex'),
    });
    expect(extractFingerprintFromHdKey(fromOrigin as any)).toBe('a1b2c3d4');

    const fromParent = new CryptoHDKey({
      origin: makeOrigin(undefined),
      parentFingerprint: Buffer.from('00112233', 'hex'),
    });
    expect(extractFingerprintFromHdKey(fromParent as any)).toBe('00112233');

    const noFingerprint = new CryptoHDKey({
      origin: makeOrigin(undefined),
      throwParentFingerprint: true,
    });
    expect(extractFingerprintFromHdKey(noFingerprint as any)).toBe('');

    const noOriginWithParent = new CryptoHDKey({
      origin: null,
      parentFingerprint: Buffer.from('aabbccdd', 'hex'),
    });
    expect(extractFingerprintFromHdKey(noOriginWithParent as any)).toBe('aabbccdd');
  });

  it('extracts xpub/fingerprint/path from CryptoHDKey and CryptoOutput across origin/path variants', () => {
    const hdKey = new CryptoHDKey({
      xpub: 'xpub-hd',
      origin: makeOrigin('cafebabe', [
        makePathComponent(84, true),
        makePathComponent(0, true),
        makePathComponent(0, false),
      ]),
    });

    expect(extractFromUrResult(hdKey as any)).toEqual({
      xpub: 'xpub-hd',
      fingerprint: 'cafebabe',
      path: "m/84'/0'/0",
    });

    const output = new CryptoOutput(hdKey);
    expect(extractFromUrResult(output as any)).toEqual({
      xpub: 'xpub-hd',
      fingerprint: 'cafebabe',
      path: "m/84'/0'/0",
    });

    const hdKeyNoOrigin = new CryptoHDKey({
      xpub: 'xpub-hd-no-origin',
      origin: null,
      parentFingerprint: Buffer.from('12345678', 'hex'),
    });
    expect(extractFromUrResult(hdKeyNoOrigin as any)).toEqual({
      xpub: 'xpub-hd-no-origin',
      fingerprint: '12345678',
      path: '',
    });

    expect(extractFromUrResult(new CryptoOutput(null) as any)).toBeNull();

    const outputNoOrigin = new CryptoOutput(
      new CryptoHDKey({
        xpub: 'xpub-output-no-origin',
        origin: null,
        parentFingerprint: Buffer.from('87654321', 'hex'),
      }),
    );
    expect(extractFromUrResult(outputNoOrigin as any)).toEqual({
      xpub: 'xpub-output-no-origin',
      fingerprint: '87654321',
      path: '',
    });
  });

  it('extracts from CryptoAccount, preferring BIP84 then falling back to first output', () => {
    const non84 = new CryptoOutput(
      new CryptoHDKey({
        xpub: 'xpub-49',
        origin: makeOrigin(undefined, [
          makePathComponent(49, true),
          makePathComponent(0, true),
          makePathComponent(0, true),
        ]),
      }),
    );
    const bip84 = new CryptoOutput(
      new CryptoHDKey({
        xpub: 'xpub-84',
        origin: makeOrigin(undefined, [
          makePathComponent(84, true),
          makePathComponent(0, true),
          makePathComponent(1, true),
        ]),
      }),
    );

    const with84 = new CryptoAccount(Buffer.from('11223344', 'hex'), [non84, bip84]);
    expect(extractFromUrResult(with84 as any)).toEqual({
      xpub: 'xpub-84',
      fingerprint: '11223344',
      path: "m/84'/0'/1'",
    });

    const fallback = new CryptoAccount(Buffer.from('55667788', 'hex'), [non84]);
    expect(extractFromUrResult(fallback as any)).toEqual({
      xpub: 'xpub-49',
      fingerprint: '55667788',
      path: "m/49'/0'/0'",
    });

    const fallbackNonHardened = new CryptoAccount(Buffer.from('10101010', 'hex'), [
      new CryptoOutput(
        new CryptoHDKey({
          xpub: 'xpub-49-nonhardened',
          origin: makeOrigin(undefined, [
            makePathComponent(49, true),
            makePathComponent(0, true),
            makePathComponent(0, false),
          ]),
        }),
      ),
    ]);
    expect(extractFromUrResult(fallbackNonHardened as any)).toEqual({
      xpub: 'xpub-49-nonhardened',
      fingerprint: '10101010',
      path: "m/49'/0'/0",
    });

    const withNullHdKeyThen84 = new CryptoAccount(null, [
      new CryptoOutput(null),
      new CryptoOutput(
        new CryptoHDKey({
          xpub: 'xpub-84-no-master-fp',
          origin: makeOrigin(undefined, [
            makePathComponent(84, true),
            makePathComponent(0, false),
            makePathComponent(0, false),
          ]),
        }),
      ),
    ]);
    expect(extractFromUrResult(withNullHdKeyThen84 as any)).toEqual({
      xpub: 'xpub-84-no-master-fp',
      fingerprint: '',
      path: "m/84'/0/0",
    });

    expect(extractFromUrResult(new CryptoAccount(Buffer.from('01020304', 'hex'), []) as any)).toBeNull();
    expect(extractFromUrResult(new CryptoAccount(Buffer.from('01020304', 'hex'), [new CryptoOutput(null)]) as any)).toBeNull();

    const fallbackNoOrigin = new CryptoAccount(Buffer.from('99aa00bb', 'hex'), [
      new CryptoOutput(
        new CryptoHDKey({
          xpub: 'xpub-fallback-no-origin',
          origin: null,
        }),
      ),
    ]);
    expect(extractFromUrResult(fallbackNoOrigin as any)).toEqual({
      xpub: 'xpub-fallback-no-origin',
      fingerprint: '99aa00bb',
      path: '',
    });
  });

  it('handles ur:bytes payloads and extraction failures', () => {
    const decodeSpy = vi.spyOn(TextDecoder.prototype, 'decode');
    expect(extractFromUrResult({ bytes: 'not-bytes' } as any)).toBeNull();

    parseDeviceJsonMock.mockReturnValueOnce({ xpub: '' });
    const emptyXpubBytes = new Uint8Array(new TextEncoder().encode('empty-xpub'));
    expect(extractFromUrResult({ bytes: emptyXpubBytes })).toBeNull();

    const validXpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
    parseDeviceJsonMock.mockReturnValueOnce({ xpub: validXpub });
    const xpubOnlyBytes = new Uint8Array(new TextEncoder().encode('xpub-only'));
    const xpubOnlyResult = extractFromUrResult({ bytes: xpubOnlyBytes });
    expect(decodeSpy).toHaveBeenCalled();
    expect(xpubOnlyResult).toEqual({
      xpub: validXpub,
      fingerprint: '',
      path: '',
    });

    parseDeviceJsonMock.mockReturnValueOnce({
      xpub: validXpub,
      fingerprint: 'cafebabe',
      derivationPath: "m/84'/0'/0'",
    });
    const fullBytes = new Uint8Array(new TextEncoder().encode('xpub-full'));
    expect(extractFromUrResult({ bytes: fullBytes })).toEqual({
      xpub: validXpub,
      fingerprint: 'cafebabe',
      path: "m/84'/0'/0'",
    });

    parseDeviceJsonMock.mockReturnValueOnce(null);
    const invalidBytes = new Uint8Array(new TextEncoder().encode(JSON.stringify({ only: 'metadata' })));
    expect(extractFromUrResult({ bytes: invalidBytes })).toBeNull();

    const throwingBytes: any = {};
    Object.defineProperty(throwingBytes, 'bytes', {
      get() {
        throw new Error('bytes getter failed');
      },
    });
    expect(extractFromUrResult(throwingBytes)).toBeNull();
    expect(loggerSpies.error).toHaveBeenCalledWith(
      'Failed to extract from UR result',
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });

  it('returns null for unrecognized input shapes', () => {
    expect(extractFromUrResult(null)).toBeNull();
    expect(extractFromUrResult({})).toBeNull();
  });
});
