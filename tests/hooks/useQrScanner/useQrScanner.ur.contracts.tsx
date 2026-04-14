import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import {
  mockBytesDecoder,
  mockUrRegistryDecoder,
  renderUseQrScanner,
} from './useQrScannerTestHarness';
import {
  extractFromUrBytesContent,
  extractFromUrResult,
  getUrType,
} from '../../../utils/urDeviceDecoder';

export function registerUrFormatProcessingContracts() {
  it('falls back to unknown UR type when detector returns null', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue(null);
    mockUrRegistryDecoder.receivePart.mockReturnValue(true);
    mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockUrRegistryDecoder.isComplete.mockReturnValue(true);
    mockUrRegistryDecoder.isSuccess.mockReturnValue(true);
    mockUrRegistryDecoder.resultRegistryType.mockReturnValue({ type: 'crypto-hdkey' });
    (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6UnknownType...',
      fingerprint: 'UNKN1234',
      path: "m/84'/0'/0'",
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:untyped/1-1/...' }]);
    });

    expect(result.current.scanResult?.xpub).toBe('xpub6UnknownType...');
    expect(result.current.error).toBeNull();
  });

  it('should detect UR format and process crypto-hdkey', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
    mockUrRegistryDecoder.receivePart.mockReturnValue(true);
    mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockUrRegistryDecoder.isComplete.mockReturnValue(true);
    mockUrRegistryDecoder.isSuccess.mockReturnValue(true);
    mockUrRegistryDecoder.resultRegistryType.mockReturnValue({ type: 'crypto-hdkey' });
    (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6UrCryptoHdKey...',
      fingerprint: 'UR123456',
      path: "m/84'/0'/0'",
    });

    act(() => {
      result.current.handleQrScan([
        { rawValue: 'ur:crypto-hdkey/1-1/...' },
      ]);
    });

    expect(result.current.scanResult?.xpub).toBe('xpub6UrCryptoHdKey...');
    expect(result.current.scanResult?.fingerprint).toBe('UR123456');
    expect(result.current.error).toBeNull();
  });

  it('should track progress for multi-part UR codes', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-output');
    mockUrRegistryDecoder.receivePart.mockReturnValue(true);
    mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(0.5);
    mockUrRegistryDecoder.isComplete.mockReturnValue(false);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:crypto-output/1-2/...' }]);
    });

    expect(result.current.urProgress).toBe(50);
    expect(result.current.scanResult).toBeNull();
    expect(result.current.cameraActive).toBe(false); // Not changed until complete
  });

  it('should handle UR decode failure', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
    mockUrRegistryDecoder.receivePart.mockReturnValue(true);
    mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockUrRegistryDecoder.isComplete.mockReturnValue(true);
    mockUrRegistryDecoder.isSuccess.mockReturnValue(false);
    mockUrRegistryDecoder.resultError.mockReturnValue('Decode error');

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/...' }]);
    });

    expect(result.current.error).toContain('UR decode failed');
    expect(result.current.scanResult).toBeNull();
  });

  it('should handle UR result extraction failure', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
    mockUrRegistryDecoder.receivePart.mockReturnValue(true);
    mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockUrRegistryDecoder.isComplete.mockReturnValue(true);
    mockUrRegistryDecoder.isSuccess.mockReturnValue(true);
    mockUrRegistryDecoder.resultRegistryType.mockReturnValue({ type: 'unknown' });
    (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue(null);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/...' }]);
    });

    expect(result.current.error).toContain('Could not extract xpub from UR type');
  });
}

export function registerCaseInsensitiveUrDetectionContracts() {
  it('should detect uppercase UR format', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
    mockUrRegistryDecoder.receivePart.mockReturnValue(true);
    mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockUrRegistryDecoder.isComplete.mockReturnValue(true);
    mockUrRegistryDecoder.isSuccess.mockReturnValue(true);
    mockUrRegistryDecoder.resultRegistryType.mockReturnValue({});
    (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6Upper...',
      fingerprint: 'UPPER123',
      path: "m/84'/0'/0'",
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'UR:CRYPTO-HDKEY/...' }]);
    });

    expect(result.current.scanResult?.xpub).toBe('xpub6Upper...');
  });

  it('should detect mixed case UR format', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
    mockBytesDecoder.receivePart.mockReturnValue(true);
    mockBytesDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockBytesDecoder.expectedPartCount.mockReturnValue(1);
    mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
    mockBytesDecoder.isComplete.mockReturnValue(true);
    mockBytesDecoder.isSuccess.mockReturnValue(true);
    mockBytesDecoder.resultUR.mockReturnValue({
      decodeCBOR: () => new TextEncoder().encode('{}'),
    });
    (extractFromUrBytesContent as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6Mixed...',
      fingerprint: 'MIXED123',
      path: "m/84'/0'/0'",
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'Ur:Bytes/...' }]);
    });

    expect(result.current.scanResult?.xpub).toBe('xpub6Mixed...');
  });
}
