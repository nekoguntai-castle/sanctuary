/**
 * Tests for utils/urPsbt.ts
 */

import { beforeEach,describe,expect,it,vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Use vi.hoisted to define mock classes before vi.mock hoisting
const { MockUR, MockUREncoder, MockURDecoder, MockCryptoPSBT } = vi.hoisted(() => {
  class MockUR {
    type: string;
    private cbor: unknown;
    constructor(cbor: unknown, type: string) {
      this.cbor = cbor;
      this.type = type;
    }
    decodeCBOR() {
      return this.cbor;
    }
  }

  class MockUREncoder {
    fragmentsLength: number;
    private counter = 0;
    constructor(_ur: MockUR, maxFragmentLength: number) {
      this.fragmentsLength = maxFragmentLength >= 100 ? 1 : 2;
    }
    nextPart() {
      this.counter += 1;
      return `ur:part:${this.counter}`;
    }
  }

  class MockURDecoder {
    complete = false;
    success = true;
    error: string | null = null;
    progress = 0.5;
    ur: MockUR | null = null;

    receivePart(_part: string) {
      // no-op
    }
    estimatedPercentComplete() {
      return this.progress;
    }
    isComplete() {
      return this.complete;
    }
    isError() {
      return Boolean(this.error);
    }
    resultError() {
      return this.error;
    }
    isSuccess() {
      return this.success;
    }
    resultUR() {
      return this.ur as MockUR;
    }
  }

  class MockCryptoPSBT {
    private buffer: Buffer;
    constructor(buffer: Buffer) {
      this.buffer = buffer;
    }
    toCBOR() {
      return this.buffer;
    }
    getPSBT() {
      return this.buffer;
    }
    static fromCBOR = vi.fn((data: unknown) => {
      if (data instanceof Uint8Array) {
        return new MockCryptoPSBT(Buffer.from(data));
      }
      if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
        return new MockCryptoPSBT(Buffer.from((data as { data: Uint8Array }).data));
      }
      throw new Error('Invalid CBOR');
    });
  }

  return { MockUR, MockUREncoder, MockURDecoder, MockCryptoPSBT };
});

vi.mock('@keystonehq/bc-ur-registry', () => ({
  CryptoPSBT: MockCryptoPSBT,
}));

vi.mock('@ngraveio/bc-ur', () => ({
  UREncoder: MockUREncoder,
  URDecoder: MockURDecoder,
  UR: MockUR,
}));

import type { URDecoder } from '@ngraveio/bc-ur';
import {
createPsbtDecoder,
encodePsbtToUrFrames,
feedDecoderPart,
getDecodedPsbt,
getPsbtFragmentCount,
getUrType,
isUrFormat,
} from '../../utils/urPsbt';

/** Testable decoder interface that exposes mock-settable properties for test manipulation */
interface TestableDecoder {
  complete: boolean;
  success: boolean;
  error: string | null;
  progress: number;
  ur: InstanceType<typeof MockUR> | null;
  receivePart: (part: string) => void;
  isError: () => boolean;
  resultError: () => string | null;
  resultUR: () => InstanceType<typeof MockUR>;
  isComplete: () => boolean;
  isSuccess: () => boolean;
  estimatedPercentComplete: () => number;
}

const psbtBase64 = Buffer.from('psbt-test').toString('base64');

describe('urPsbt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('encodePsbtToUrFrames', () => {
    it('returns a single frame when fragment count is 1', () => {
      const frames = encodePsbtToUrFrames(psbtBase64, 100);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatch(/^ur:part:/);
    });

    it('returns multiple frames when fragment count is greater than 1', () => {
      const frames = encodePsbtToUrFrames(psbtBase64, 10);
      expect(frames.length).toBeGreaterThan(1);
    });

    it('throws wrapped message when encoding fails with an Error', () => {
      vi.spyOn(MockCryptoPSBT.prototype, 'toCBOR').mockImplementationOnce(() => {
        throw new Error('cbor failed');
      });

      expect(() => encodePsbtToUrFrames(psbtBase64, 100)).toThrow('Failed to encode PSBT: cbor failed');
    });

    it('throws unknown message when encoding fails with a non-Error', () => {
      vi.spyOn(MockCryptoPSBT.prototype, 'toCBOR').mockImplementationOnce(() => {
        throw 'boom';
      });

      expect(() => encodePsbtToUrFrames(psbtBase64, 100)).toThrow('Failed to encode PSBT: Unknown error');
    });
  });

  describe('getPsbtFragmentCount', () => {
    it('returns fragment count from encoder', () => {
      expect(getPsbtFragmentCount(psbtBase64, 100)).toBe(1);
      expect(getPsbtFragmentCount(psbtBase64, 10)).toBe(2);
    });
  });

  describe('createPsbtDecoder', () => {
    it('returns a decoder instance', () => {
      const decoder = createPsbtDecoder();
      expect(decoder).toBeInstanceOf(MockURDecoder);
    });
  });

  describe('feedDecoderPart', () => {
    it('reports progress and completion', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.progress = 0.25;
      decoder.complete = false;

      const result = feedDecoderPart(decoder as unknown as URDecoder,'ur:part:1');
      expect(result.complete).toBe(false);
      expect(result.progress).toBe(25);
    });

    it('returns error when decoder is in error state', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.error = 'bad data';

      const result = feedDecoderPart(decoder as unknown as URDecoder,'ur:part:1');
      expect(result.error).toBe('bad data');
    });

    it('falls back to default decoder error message when resultError is empty', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.isError = () => true;
      decoder.resultError = () => '';

      const result = feedDecoderPart(decoder as unknown as URDecoder,'ur:part:1');
      expect(result.error).toBe('Decoding error');
    });

    it('returns thrown Error message from decoder.receivePart', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.receivePart = () => {
        throw new Error('bad scan');
      };

      const result = feedDecoderPart(decoder as unknown as URDecoder,'ur:part:1');
      expect(result).toEqual({ complete: false, progress: 0, error: 'bad scan' });
    });

    it('returns fallback message when decoder.receivePart throws a non-Error', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.receivePart = () => {
        throw 'bad scan';
      };

      const result = feedDecoderPart(decoder as unknown as URDecoder,'ur:part:1');
      expect(result).toEqual({ complete: false, progress: 0, error: 'Failed to process QR code' });
    });
  });

  describe('getDecodedPsbt', () => {
    it('throws decoder resultError when decode is not successful', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.complete = true;
      decoder.success = false;
      decoder.error = 'bad decode';

      expect(() => getDecodedPsbt(decoder as unknown as URDecoder)).toThrow('bad decode');
    });

    it('falls back to default decode message when decode is not successful without resultError', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.complete = true;
      decoder.success = false;
      decoder.error = null;

      expect(() => getDecodedPsbt(decoder as unknown as URDecoder)).toThrow('Decoding failed');
    });

    it('decodes raw crypto-psbt bytes', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      const raw = Buffer.from([0x70, 0x73, 0x62, 0x74, 0x01]);
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR(raw, 'crypto-psbt');

      const decoded = getDecodedPsbt(decoder as unknown as URDecoder);
      expect(decoded).toBe(raw.toString('base64'));
    });

    it('falls back to CryptoPSBT wrapper', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      const data = { data: new Uint8Array([1, 2, 3, 4]) };
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR(data, 'crypto-psbt');

      const decoded = getDecodedPsbt(decoder as unknown as URDecoder);
      expect(decoded).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
    });

    it('falls back to CryptoPSBT wrapper for non-magic Uint8Array payloads', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      const raw = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR(raw, 'crypto-psbt');

      const decoded = getDecodedPsbt(decoder as unknown as URDecoder);
      expect(decoded).toBe(Buffer.from(raw).toString('base64'));
    });

    it('extracts raw data property when CryptoPSBT wrapper decode fails', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      const rawPsbt = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0x0a]);
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR({ data: rawPsbt }, 'crypto-psbt');
      MockCryptoPSBT.fromCBOR.mockImplementationOnce(() => {
        throw new Error('wrapper failed');
      });

      const decoded = getDecodedPsbt(decoder as unknown as URDecoder);
      expect(decoded).toBe(Buffer.from(rawPsbt).toString('base64'));
    });

    it('rethrows wrapped error when wrapper fails and raw extraction is not PSBT', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR({ data: new Uint8Array([1, 2, 3, 4]) }, 'crypto-psbt');
      MockCryptoPSBT.fromCBOR.mockImplementationOnce(() => {
        throw new Error('wrapper failed');
      });

      expect(() => getDecodedPsbt(decoder as unknown as URDecoder)).toThrow(
        'Failed to decode PSBT: wrapper failed'
      );
    });

    it('rethrows wrapped error when wrapper fails and cbor object has no data property', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR({ notData: new Uint8Array([1, 2]) }, 'crypto-psbt');
      MockCryptoPSBT.fromCBOR.mockImplementationOnce(() => {
        throw new Error('wrapper failed');
      });

      expect(() => getDecodedPsbt(decoder as unknown as URDecoder)).toThrow(
        'Failed to decode PSBT: wrapper failed'
      );
    });

    it('rethrows wrapped error when wrapper fails and data property is not a byte container', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.complete = true;
      decoder.success = true;
      // `data` is present but is neither a Uint8Array nor a Buffer, so
      // getDataPropertyBytes hits the `? bytes : null` false branch.
      decoder.ur = new MockUR({ data: 'not-bytes' }, 'crypto-psbt');
      MockCryptoPSBT.fromCBOR.mockImplementationOnce(() => {
        throw new Error('wrapper failed');
      });

      expect(() => getDecodedPsbt(decoder as unknown as URDecoder)).toThrow(
        'Failed to decode PSBT: wrapper failed'
      );
    });

    it('decodes bytes UR with raw psbt magic', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      const raw = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0x02]);
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR(raw, 'bytes');

      const decoded = getDecodedPsbt(decoder as unknown as URDecoder);
      expect(decoded).toBe(Buffer.from(raw).toString('base64'));
    });

    it('decodes bytes UR as text when not psbt magic', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      const raw = new Uint8Array([0x63, 0x48, 0x4e, 0x69]); // cHNi
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR(raw, 'bytes');

      const decoded = getDecodedPsbt(decoder as unknown as URDecoder);
      expect(decoded).toBe('cHNi');
    });

    it('throws when decoder is incomplete', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.complete = false;
      expect(() => getDecodedPsbt(decoder as unknown as URDecoder)).toThrow('Decoder is not complete');
    });

    it('throws wrapped error for unsupported UR type', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.complete = true;
      decoder.success = true;
      decoder.ur = new MockUR(new Uint8Array([1, 2]), 'crypto-hdkey');

      expect(() => getDecodedPsbt(decoder as unknown as URDecoder)).toThrow(
        'Failed to decode PSBT: Unsupported UR type: crypto-hdkey'
      );
    });

    it('throws unknown wrapped error when a non-Error is thrown during decode', () => {
      const decoder = createPsbtDecoder() as unknown as TestableDecoder;
      decoder.complete = true;
      decoder.success = true;
      decoder.resultUR = () => {
        throw 'boom';
      };

      expect(() => getDecodedPsbt(decoder as unknown as URDecoder)).toThrow(
        'Failed to decode PSBT: Unknown error'
      );
    });
  });

  describe('isUrFormat', () => {
    it('returns true for ur: prefix', () => {
      expect(isUrFormat('ur:crypto-psbt/...')).toBe(true);
    });

    it('returns true for uppercase UR: prefix', () => {
      expect(isUrFormat('UR:crypto-psbt/...')).toBe(true);
    });

    it('returns true for mixed case Ur: prefix', () => {
      expect(isUrFormat('Ur:crypto-psbt/...')).toBe(true);
    });

    it('returns false for non-ur strings', () => {
      expect(isUrFormat('bitcoin:bc1q...')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isUrFormat('')).toBe(false);
    });

    it('returns false for string starting with ur but no colon', () => {
      expect(isUrFormat('uranium')).toBe(false);
    });

    it('returns true for ur:bytes format', () => {
      expect(isUrFormat('ur:bytes/abc123')).toBe(true);
    });

    it('returns true for ur:crypto-account format', () => {
      expect(isUrFormat('ur:crypto-account/xyz789')).toBe(true);
    });

    it('returns true for multi-part UR strings', () => {
      expect(isUrFormat('ur:crypto-psbt/1-5/abc123def')).toBe(true);
    });
  });

  describe('getUrType', () => {
    it('extracts crypto-psbt type', () => {
      expect(getUrType('ur:crypto-psbt/abc123')).toBe('crypto-psbt');
    });

    it('extracts bytes type', () => {
      expect(getUrType('ur:bytes/abc123')).toBe('bytes');
    });

    it('extracts crypto-account type', () => {
      expect(getUrType('ur:crypto-account/xyz789')).toBe('crypto-account');
    });

    it('extracts crypto-hdkey type', () => {
      expect(getUrType('ur:crypto-hdkey/data')).toBe('crypto-hdkey');
    });

    it('extracts crypto-output type', () => {
      expect(getUrType('ur:crypto-output/descriptor')).toBe('crypto-output');
    });

    it('handles uppercase input', () => {
      expect(getUrType('UR:CRYPTO-PSBT/ABC123')).toBe('crypto-psbt');
    });

    it('handles mixed case input', () => {
      expect(getUrType('Ur:Crypto-PSBT/Data')).toBe('crypto-psbt');
    });

    it('returns null for invalid format', () => {
      expect(getUrType('not-a-ur')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getUrType('')).toBeNull();
    });

    it('returns null for ur: without type', () => {
      expect(getUrType('ur:')).toBeNull();
    });

    it('returns null for ur:/ without type', () => {
      expect(getUrType('ur:/')).toBeNull();
    });

    it('handles types with numbers', () => {
      expect(getUrType('ur:crypto-psbt-2/abc')).toBe('crypto-psbt-2');
    });

    it('handles multi-part UR strings (extracts type before part number)', () => {
      expect(getUrType('ur:crypto-psbt/1-5/abc123def')).toBe('crypto-psbt');
    });

    it('handles simple type with data', () => {
      expect(getUrType('ur:bytes/abcdef')).toBe('bytes');
    });
  });
});
