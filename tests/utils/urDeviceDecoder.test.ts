import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { parseDeviceJsonMock } = vi.hoisted(() => ({
  parseDeviceJsonMock: vi.fn(),
}));
vi.mock('../../services/deviceParsers', () => ({
  parseDeviceJson: parseDeviceJsonMock,
}));

const registry = vi.hoisted(() => {
  class MockPathComponent {
    constructor(
      private readonly index: number,
      private readonly hardened: boolean
    ) {}

    getIndex(): number {
      return this.index;
    }

    isHardened(): boolean {
      return this.hardened;
    }
  }

  class MockOrigin {
    constructor(
      private readonly sourceFingerprint?: Uint8Array,
      private readonly components: InstanceType<typeof MockPathComponent>[] = []
    ) {}

    getSourceFingerprint(): Uint8Array | undefined {
      return this.sourceFingerprint;
    }

    getComponents(): InstanceType<typeof MockPathComponent>[] {
      return this.components;
    }
  }

  class MockCryptoHDKey {
    constructor(
      private readonly xpub = 'xpub-default',
      private readonly origin: InstanceType<typeof MockOrigin> | null = null,
      private readonly parentFingerprint?: Uint8Array,
      private readonly throwOnParentFingerprint = false
    ) {}

    getBip32Key(): string {
      return this.xpub;
    }

    getOrigin(): InstanceType<typeof MockOrigin> | null {
      return this.origin;
    }

    getParentFingerprint(): Uint8Array | undefined {
      if (this.throwOnParentFingerprint) {
        throw new Error('no parent fingerprint');
      }
      return this.parentFingerprint;
    }
  }

  class MockCryptoOutput {
    constructor(private readonly hdKey: InstanceType<typeof MockCryptoHDKey> | null) {}

    getHDKey(): InstanceType<typeof MockCryptoHDKey> | null {
      return this.hdKey;
    }
  }

  class MockCryptoAccount {
    constructor(
      private readonly masterFingerprint?: Uint8Array,
      private readonly outputs: InstanceType<typeof MockCryptoOutput>[] = []
    ) {}

    getMasterFingerprint(): Uint8Array | undefined {
      return this.masterFingerprint;
    }

    getOutputDescriptors(): InstanceType<typeof MockCryptoOutput>[] {
      return this.outputs;
    }
  }

  return {
    MockPathComponent,
    MockOrigin,
    MockCryptoHDKey,
    MockCryptoOutput,
    MockCryptoAccount,
  };
});

vi.mock('@keystonehq/bc-ur-registry', () => ({
  CryptoHDKey: registry.MockCryptoHDKey,
  CryptoOutput: registry.MockCryptoOutput,
  CryptoAccount: registry.MockCryptoAccount,
}));

const {
  MockPathComponent,
  MockOrigin,
  MockCryptoHDKey,
} = registry;

import {
  extractFingerprintFromHdKey,
  extractFromUrBytesContent,
  extractFromUrResult,
  getUrType,
  isUrFormat,
} from '../../utils/urDeviceDecoder';
import { CryptoAccount, CryptoHDKey, CryptoOutput } from '@keystonehq/bc-ur-registry';

describe('urDeviceDecoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts source fingerprint before parent fingerprint', () => {
    const origin = new MockOrigin(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
    const hdKey = new CryptoHDKey('xpub-1', origin, Buffer.from([1, 2, 3, 4]));

    expect(extractFingerprintFromHdKey(hdKey as unknown as MockCryptoHDKey)).toBe('aabbccdd');
  });

  it('falls back to parent fingerprint when source fingerprint is unavailable', () => {
    const hdKey = new CryptoHDKey(
      'xpub-2',
      new MockOrigin(undefined),
      Buffer.from([0xde, 0xad, 0xbe, 0xef])
    );

    expect(extractFingerprintFromHdKey(hdKey as unknown as MockCryptoHDKey)).toBe('deadbeef');
  });

  it('returns empty fingerprint when no fingerprint data is available', () => {
    const hdKey = new CryptoHDKey('xpub-3', null, undefined, true);
    expect(extractFingerprintFromHdKey(hdKey as unknown as MockCryptoHDKey)).toBe('');
  });

  it('extracts xpub/fingerprint/path from CryptoHDKey UR result', () => {
    const origin = new MockOrigin(Buffer.from([0x12, 0x34, 0x56, 0x78]), [
      new MockPathComponent(84, true),
      new MockPathComponent(0, true),
      new MockPathComponent(0, true),
    ]);
    const hdKey = new CryptoHDKey('xpub-hd-key', origin);

    expect(extractFromUrResult(hdKey)).toEqual({
      xpub: 'xpub-hd-key',
      fingerprint: '12345678',
      path: "m/84'/0'/0'",
    });
  });

  it('returns empty path/fingerprint when CryptoHDKey has no origin data', () => {
    const hdKey = new CryptoHDKey('xpub-no-origin', null, undefined);

    expect(extractFromUrResult(hdKey)).toEqual({
      xpub: 'xpub-no-origin',
      fingerprint: '',
      path: '',
    });
  });

  it('supports non-hardened derivation path components', () => {
    const origin = new MockOrigin(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]), [
      new MockPathComponent(84, true),
      new MockPathComponent(0, false),
      new MockPathComponent(5, false),
    ]);
    const hdKey = new CryptoHDKey('xpub-non-hardened', origin);

    expect(extractFromUrResult(hdKey)).toEqual({
      xpub: 'xpub-non-hardened',
      fingerprint: 'aabbccdd',
      path: "m/84'/0/5",
    });
  });

  it('returns empty path when origin components are undefined', () => {
    const weirdOrigin = {
      getSourceFingerprint: () => Buffer.from([0x01, 0x02, 0x03, 0x04]),
      getComponents: () => undefined,
    };
    const hdKey = new CryptoHDKey('xpub-weird-origin', weirdOrigin as unknown as MockOrigin);

    expect(extractFromUrResult(hdKey)).toEqual({
      xpub: 'xpub-weird-origin',
      fingerprint: '01020304',
      path: '',
    });
  });

  it('extracts data from CryptoOutput UR result', () => {
    const origin = new MockOrigin(Buffer.from([0x11, 0x22, 0x33, 0x44]), [
      new MockPathComponent(49, true),
      new MockPathComponent(0, true),
      new MockPathComponent(0, true),
    ]);
    const output = new CryptoOutput(new CryptoHDKey('xpub-output', origin));

    expect(extractFromUrResult(output)).toEqual({
      xpub: 'xpub-output',
      fingerprint: '11223344',
      path: "m/49'/0'/0'",
    });
  });

  it('returns null for CryptoOutput without an HDKey', () => {
    const output = new CryptoOutput(null);
    expect(extractFromUrResult(output)).toBeNull();
  });

  it('prefers BIP84 output when extracting from CryptoAccount UR result', () => {
    const account = new CryptoAccount(
      Buffer.from([0xab, 0xcd, 0xef, 0x01]),
      [
        new CryptoOutput(
          new CryptoHDKey(
            'xpub-nested',
            new MockOrigin(undefined, [
              new MockPathComponent(49, true),
              new MockPathComponent(0, true),
              new MockPathComponent(0, true),
            ])
          )
        ),
        new CryptoOutput(
          new CryptoHDKey(
            'xpub-native',
            new MockOrigin(undefined, [
              new MockPathComponent(84, true),
              new MockPathComponent(0, true),
              new MockPathComponent(0, true),
            ])
          )
        ),
      ]
    );

    expect(extractFromUrResult(account)).toEqual({
      xpub: 'xpub-native',
      fingerprint: 'abcdef01',
      path: "m/84'/0'/0'",
    });
  });

  it('falls back to first account output when no BIP84 path exists', () => {
    const account = new CryptoAccount(
      Buffer.from([0x10, 0x20, 0x30, 0x40]),
      [
        new CryptoOutput(
          new CryptoHDKey(
            'xpub-first',
            new MockOrigin(undefined, [
              new MockPathComponent(48, true),
              new MockPathComponent(0, true),
              new MockPathComponent(0, true),
            ])
          )
        ),
      ]
    );

    expect(extractFromUrResult(account)).toEqual({
      xpub: 'xpub-first',
      fingerprint: '10203040',
      path: "m/48'/0'/0'",
    });
  });

  it('returns null when CryptoAccount outputs have no HDKeys', () => {
    const account = new CryptoAccount(undefined, [new CryptoOutput(null)]);
    expect(extractFromUrResult(account)).toBeNull();
  });

  it('returns null when CryptoAccount has no outputs', () => {
    const account = new CryptoAccount(undefined, []);
    expect(extractFromUrResult(account)).toBeNull();
  });

  it('extracts xpub data from ur:bytes payload', () => {
    const OriginalTextDecoder = globalThis.TextDecoder;
    const OriginalUint8Array = globalThis.Uint8Array;
    class StableTextDecoder {
      constructor(_label?: string) {}
      decode(_input?: unknown) {
        return '{"descriptor":"ok"}';
      }
    }
    class AcceptAllUint8Array {
      static [Symbol.hasInstance](_value: unknown) {
        return true;
      }
    }
    // @ts-expect-error test override
    globalThis.TextDecoder = StableTextDecoder;
    // @ts-expect-error test override
    globalThis.Uint8Array = AcceptAllUint8Array;

    parseDeviceJsonMock.mockReturnValue({
      format: 'passport',
      xpub: 'xpub-bytes',
      fingerprint: 'f1f2f3f4',
      derivationPath: "m/84'/0'/0'",
    });

    try {
      const bytesResult = extractFromUrResult({
        bytes: new TextEncoder().encode('{"descriptor":"ok"}'),
      });

      expect(parseDeviceJsonMock).toHaveBeenCalledWith('{"descriptor":"ok"}');
      expect(bytesResult).toEqual({
        xpub: 'xpub-bytes',
        fingerprint: 'f1f2f3f4',
        path: "m/84'/0'/0'",
      });
    } finally {
      globalThis.TextDecoder = OriginalTextDecoder;
      globalThis.Uint8Array = OriginalUint8Array;
    }
  });

  it('defaults fingerprint/path for ur:bytes payload when parser omits them', () => {
    const OriginalTextDecoder = globalThis.TextDecoder;
    const OriginalUint8Array = globalThis.Uint8Array;
    class StableTextDecoder {
      constructor(_label?: string) {}
      decode(_input?: unknown) {
        return '{"descriptor":"minimal"}';
      }
    }
    class AcceptAllUint8Array {
      static [Symbol.hasInstance](_value: unknown) {
        return true;
      }
    }
    // @ts-expect-error test override
    globalThis.TextDecoder = StableTextDecoder;
    // @ts-expect-error test override
    globalThis.Uint8Array = AcceptAllUint8Array;

    parseDeviceJsonMock.mockReturnValue({
      format: 'passport',
      xpub: 'xpub-minimal',
    });

    try {
      expect(
        extractFromUrResult({
          bytes: new TextEncoder().encode('{"descriptor":"minimal"}'),
        })
      ).toEqual({
        xpub: 'xpub-minimal',
        fingerprint: '',
        path: '',
      });
    } finally {
      globalThis.TextDecoder = OriginalTextDecoder;
      globalThis.Uint8Array = OriginalUint8Array;
    }
  });

  it('returns null when ur:bytes content cannot be parsed', () => {
    const OriginalTextDecoder = globalThis.TextDecoder;
    const OriginalUint8Array = globalThis.Uint8Array;
    class StableTextDecoder {
      constructor(_label?: string) {}
      decode(_input?: unknown) {
        return 'invalid';
      }
    }
    class AcceptAllUint8Array {
      static [Symbol.hasInstance](_value: unknown) {
        return true;
      }
    }
    // @ts-expect-error test override
    globalThis.TextDecoder = StableTextDecoder;
    // @ts-expect-error test override
    globalThis.Uint8Array = AcceptAllUint8Array;

    parseDeviceJsonMock.mockReturnValue(null);

    try {
      expect(
        extractFromUrResult({
          bytes: new TextEncoder().encode('invalid'),
        })
      ).toBeNull();
      expect(parseDeviceJsonMock).toHaveBeenCalledWith('invalid');
    } finally {
      globalThis.TextDecoder = OriginalTextDecoder;
      globalThis.Uint8Array = OriginalUint8Array;
    }
  });

  it('returns null when ur:bytes parser result has no xpub', () => {
    const OriginalTextDecoder = globalThis.TextDecoder;
    const OriginalUint8Array = globalThis.Uint8Array;
    class StableTextDecoder {
      constructor(_label?: string) {}
      decode(_input?: unknown) {
        return '{"descriptor":"missing-xpub"}';
      }
    }
    class AcceptAllUint8Array {
      static [Symbol.hasInstance](_value: unknown) {
        return true;
      }
    }
    // @ts-expect-error test override
    globalThis.TextDecoder = StableTextDecoder;
    // @ts-expect-error test override
    globalThis.Uint8Array = AcceptAllUint8Array;

    parseDeviceJsonMock.mockReturnValue({ format: 'unknown', derivationPath: "m/84'/0'/0'" });

    try {
      expect(
        extractFromUrResult({
          bytes: new TextEncoder().encode('{"descriptor":"missing-xpub"}'),
        })
      ).toBeNull();
      expect(parseDeviceJsonMock).toHaveBeenCalledWith('{"descriptor":"missing-xpub"}');
    } finally {
      globalThis.TextDecoder = OriginalTextDecoder;
      globalThis.Uint8Array = OriginalUint8Array;
    }
  });

  it('returns null when ur:bytes payload is not Uint8Array', () => {
    expect(
      extractFromUrResult({
        bytes: 'plain text',
      })
    ).toBeNull();
  });

  it('swallows text decoding errors in ur:bytes handling', () => {
    const OriginalTextDecoder = globalThis.TextDecoder;
    const OriginalUint8Array = globalThis.Uint8Array;
    class ThrowingTextDecoder {
      constructor(_label?: string) {}
      decode(_input?: unknown) {
        throw new Error('decode failed');
      }
    }
    class AcceptAllUint8Array {
      static [Symbol.hasInstance](_value: unknown) {
        return true;
      }
    }
    // @ts-expect-error test override
    globalThis.TextDecoder = ThrowingTextDecoder;
    // @ts-expect-error test override
    globalThis.Uint8Array = AcceptAllUint8Array;

    try {
      const result = extractFromUrResult({
        bytes: new Uint8Array([123, 125]),
      });
      expect(result).toBeNull();
    } finally {
      globalThis.TextDecoder = OriginalTextDecoder;
      globalThis.Uint8Array = OriginalUint8Array;
    }
  });

  it('returns null when extraction throws unexpectedly', () => {
    const badHdKey = {
      getBip32Key: () => {
        throw new Error('boom');
      },
    };

    const result = extractFromUrResult(Object.setPrototypeOf(badHdKey, MockCryptoHDKey.prototype));
    expect(result).toBeNull();
  });

  it('extracts from decoded ur:bytes text helper', () => {
    parseDeviceJsonMock.mockReturnValue({
      format: 'json',
      xpub: 'xpub-text',
      fingerprint: 'a1b2c3d4',
      derivationPath: "m/48'/0'/0'",
    });

    expect(extractFromUrBytesContent('{"wallet":"data"}')).toEqual({
      xpub: 'xpub-text',
      fingerprint: 'a1b2c3d4',
      path: "m/48'/0'/0'",
    });
  });

  it('defaults empty fingerprint/path when helper parser omits them', () => {
    parseDeviceJsonMock.mockReturnValue({
      format: 'json',
      xpub: 'xpub-text-only',
    });

    expect(extractFromUrBytesContent('{"wallet":"minimal"}')).toEqual({
      xpub: 'xpub-text-only',
      fingerprint: '',
      path: '',
    });
  });

  it('returns null from ur:bytes helper when parser finds no xpub', () => {
    parseDeviceJsonMock.mockReturnValue({ format: 'unknown' });
    expect(extractFromUrBytesContent('not wallet data')).toBeNull();
  });

  it('detects UR format and extracts UR type', () => {
    expect(isUrFormat('ur:crypto-hdkey/abc')).toBe(true);
    expect(isUrFormat('UR:BYTES/abc')).toBe(true);
    expect(isUrFormat('xpub123')).toBe(false);

    expect(getUrType('ur:crypto-account/foo')).toBe('crypto-account');
    expect(getUrType('UR:BYTES/bar')).toBe('bytes');
    expect(getUrType('not-ur')).toBeNull();
  });
});
