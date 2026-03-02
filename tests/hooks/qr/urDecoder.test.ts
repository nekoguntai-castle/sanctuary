import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MutableRefObject } from 'react';

const bytesFns = {
  receivePart: vi.fn(),
  estimatedPercentComplete: vi.fn(),
  expectedPartCount: vi.fn(),
  receivedPartIndexes: vi.fn(),
  isComplete: vi.fn(),
  isSuccess: vi.fn(),
  resultError: vi.fn(),
  resultUR: vi.fn(),
};

const registryFns = {
  receivePart: vi.fn(),
  estimatedPercentComplete: vi.fn(),
  isComplete: vi.fn(),
  isSuccess: vi.fn(),
  resultError: vi.fn(),
  resultRegistryType: vi.fn(),
};

vi.mock('@ngraveio/bc-ur', () => ({
  URDecoder: class MockBytesDecoder {
    receivePart(content: string) { return bytesFns.receivePart(content); }
    estimatedPercentComplete() { return bytesFns.estimatedPercentComplete(); }
    expectedPartCount() { return bytesFns.expectedPartCount(); }
    receivedPartIndexes() { return bytesFns.receivedPartIndexes(); }
    isComplete() { return bytesFns.isComplete(); }
    isSuccess() { return bytesFns.isSuccess(); }
    resultError() { return bytesFns.resultError(); }
    resultUR() { return bytesFns.resultUR(); }
  },
}));

vi.mock('@keystonehq/bc-ur-registry', () => ({
  URRegistryDecoder: class MockRegistryDecoder {
    receivePart(content: string) { return registryFns.receivePart(content); }
    estimatedPercentComplete() { return registryFns.estimatedPercentComplete(); }
    isComplete() { return registryFns.isComplete(); }
    isSuccess() { return registryFns.isSuccess(); }
    resultError() { return registryFns.resultError(); }
    resultRegistryType() { return registryFns.resultRegistryType(); }
  },
}));

const mockExtractFromUrResult = vi.fn();
const mockExtractFromUrBytesContent = vi.fn();

vi.mock('../../../utils/urDeviceDecoder', () => ({
  extractFromUrResult: (...args: unknown[]) => mockExtractFromUrResult(...args),
  extractFromUrBytesContent: (...args: unknown[]) => mockExtractFromUrBytesContent(...args),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { processUrBytes, processUrRegistry } from '../../../hooks/qr/urDecoder';

function createCallbacks() {
  const createScanResult = vi.fn((xpub: string, fingerprint?: string, path?: string) => ({ xpub, fingerprint, path }));
  return {
    setUrProgress: vi.fn(),
    setCameraActive: vi.fn(),
    setScanning: vi.fn(),
    setError: vi.fn(),
    setScanResult: vi.fn(),
    createScanResult,
  };
}

describe('urDecoder helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    bytesFns.receivePart.mockReturnValue(true);
    bytesFns.estimatedPercentComplete.mockReturnValue(0.42);
    bytesFns.expectedPartCount.mockReturnValue(3);
    bytesFns.receivedPartIndexes.mockReturnValue([0, 2]);
    bytesFns.isComplete.mockReturnValue(false);
    bytesFns.isSuccess.mockReturnValue(true);
    bytesFns.resultError.mockReturnValue(null);
    bytesFns.resultUR.mockReturnValue({
      decodeCBOR: () => new TextEncoder().encode(JSON.stringify({ xfp: 'abcd1234', xpub: 'xpub-bytes', path: "m/84'/0'/0'" })),
    });
    mockExtractFromUrBytesContent.mockReturnValue({
      xpub: 'xpub-bytes',
      fingerprint: 'abcd1234',
      path: "m/84'/0'/0'",
    });

    registryFns.receivePart.mockReturnValue(undefined);
    registryFns.estimatedPercentComplete.mockReturnValue(0.6);
    registryFns.isComplete.mockReturnValue(false);
    registryFns.isSuccess.mockReturnValue(true);
    registryFns.resultError.mockReturnValue(null);
    registryFns.resultRegistryType.mockReturnValue({ constructor: { name: 'CryptoHDKey' } });
    mockExtractFromUrResult.mockReturnValue({
      xpub: 'xpub-registry',
      fingerprint: 'f1f1f1f1',
      path: "m/84'/0'/0'",
    });
  });

  it('processUrBytes returns false while assembly is incomplete', () => {
    const ref = { current: null } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    const done = processUrBytes('ur:bytes/1-2/abc', ref, callbacks as any);

    expect(done).toBe(false);
    expect(callbacks.setUrProgress).toHaveBeenCalledWith(42);
    expect(ref.current).toBeTruthy();
  });

  it('processUrBytes completes successfully and resets decoder ref', () => {
    bytesFns.isComplete.mockReturnValue(true);
    const ref = { current: null } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    const done = processUrBytes('ur:bytes/1-2/abc', ref, callbacks as any);

    expect(done).toBe(true);
    expect(callbacks.setCameraActive).toHaveBeenCalledWith(false);
    expect(callbacks.setScanning).toHaveBeenCalledWith(true);
    expect(callbacks.setError).toHaveBeenCalledWith(null);
    expect(callbacks.createScanResult).toHaveBeenCalledWith('xpub-bytes', 'abcd1234', "m/84'/0'/0'");
    expect(callbacks.setScanResult).toHaveBeenCalled();
    expect(callbacks.setScanning).toHaveBeenLastCalledWith(false);
    expect(callbacks.setUrProgress).toHaveBeenLastCalledWith(0);
    expect(ref.current).toBeNull();
  });

  it('processUrBytes throws decode error with unknown fallback and supports decoder reuse', () => {
    bytesFns.isComplete.mockReturnValue(true);
    bytesFns.isSuccess.mockReturnValue(false);
    bytesFns.resultError.mockReturnValue(null);
    const existingDecoder = {
      receivePart: (content: string) => bytesFns.receivePart(content),
      estimatedPercentComplete: () => bytesFns.estimatedPercentComplete(),
      expectedPartCount: () => bytesFns.expectedPartCount(),
      receivedPartIndexes: () => bytesFns.receivedPartIndexes(),
      isComplete: () => bytesFns.isComplete(),
      isSuccess: () => bytesFns.isSuccess(),
      resultError: () => bytesFns.resultError(),
      resultUR: () => bytesFns.resultUR(),
    } as any;
    const ref = { current: existingDecoder } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    expect(() => processUrBytes('ur:bytes/2-2/xyz', ref, callbacks as any))
      .toThrow('UR bytes decode failed: unknown error');
    expect(ref.current).toBe(existingDecoder);
  });

  it('processUrBytes throws when extracted bytes payload has no xpub', () => {
    bytesFns.isComplete.mockReturnValue(true);
    mockExtractFromUrBytesContent.mockReturnValue({ fingerprint: 'only-fp' });
    const ref = { current: null } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    expect(() => processUrBytes('ur:bytes/2-2/xyz', ref, callbacks as any))
      .toThrow('Could not extract xpub from ur:bytes content');
  });

  it('processUrRegistry returns false while assembly is incomplete', () => {
    const ref = { current: null } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    const done = processUrRegistry('ur:crypto-hdkey/1-2/abc', 'crypto-hdkey', ref, callbacks as any);

    expect(done).toBe(false);
    expect(callbacks.setUrProgress).toHaveBeenCalledWith(60);
    expect(ref.current).toBeTruthy();
  });

  it('processUrRegistry reuses existing decoder instance when provided', () => {
    const existingDecoder = {
      receivePart: (content: string) => registryFns.receivePart(content),
      estimatedPercentComplete: () => registryFns.estimatedPercentComplete(),
      isComplete: () => registryFns.isComplete(),
      isSuccess: () => registryFns.isSuccess(),
      resultError: () => registryFns.resultError(),
      resultRegistryType: () => registryFns.resultRegistryType(),
    } as any;
    const ref = { current: existingDecoder } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    const done = processUrRegistry('ur:crypto-hdkey/1-2/reuse', 'crypto-hdkey', ref, callbacks as any);

    expect(done).toBe(false);
    expect(ref.current).toBe(existingDecoder);
  });

  it('processUrRegistry completes successfully and resets decoder ref', () => {
    registryFns.isComplete.mockReturnValue(true);
    const ref = { current: null } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    const done = processUrRegistry('ur:crypto-hdkey/2-2/abc', 'crypto-hdkey', ref, callbacks as any);

    expect(done).toBe(true);
    expect(callbacks.createScanResult).toHaveBeenCalledWith('xpub-registry', 'f1f1f1f1', "m/84'/0'/0'");
    expect(callbacks.setScanResult).toHaveBeenCalled();
    expect(ref.current).toBeNull();
  });

  it('processUrRegistry throws with unknown decode fallback when decoder is unsuccessful', () => {
    registryFns.isComplete.mockReturnValue(true);
    registryFns.isSuccess.mockReturnValue(false);
    registryFns.resultError.mockReturnValue('');
    const ref = { current: null } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    expect(() => processUrRegistry('ur:crypto-hdkey/2-2/abc', 'crypto-hdkey', ref, callbacks as any))
      .toThrow('UR decode failed: unknown error');
  });

  it('processUrRegistry throws extraction error using registry type fallback name', () => {
    registryFns.isComplete.mockReturnValue(true);
    mockExtractFromUrResult.mockReturnValue(null);
    registryFns.resultRegistryType.mockReturnValue(undefined);
    const ref = { current: null } as MutableRefObject<any>;
    const callbacks = createCallbacks();

    expect(() => processUrRegistry('ur:crypto-hdkey/2-2/abc', 'crypto-hdkey', ref, callbacks as any))
      .toThrow('Could not extract xpub from UR type: crypto-hdkey');
  });
});
