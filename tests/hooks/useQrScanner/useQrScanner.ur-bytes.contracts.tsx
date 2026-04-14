import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import {
  mockBytesDecoder,
  renderUseQrScanner,
} from './useQrScannerTestHarness';
import {
  extractFromUrBytesContent,
  getUrType,
} from '../../../utils/urDeviceDecoder';

export function registerUrBytesFormatProcessingContracts() {
  it('should detect and process ur:bytes format', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
    mockBytesDecoder.receivePart.mockReturnValue(true);
    mockBytesDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockBytesDecoder.expectedPartCount.mockReturnValue(1);
    mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
    mockBytesDecoder.isComplete.mockReturnValue(true);
    mockBytesDecoder.isSuccess.mockReturnValue(true);
    mockBytesDecoder.resultUR.mockReturnValue({
      decodeCBOR: () => new TextEncoder().encode('{"xpub": "xpub..."}'),
    });
    (extractFromUrBytesContent as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6UrBytes...',
      fingerprint: 'BYTES123',
      path: "m/84'/0'/0'",
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:bytes/...' }]);
    });

    expect(result.current.scanResult?.xpub).toBe('xpub6UrBytes...');
    expect(result.current.scanResult?.fingerprint).toBe('BYTES123');
  });

  it('should track progress for multi-part ur:bytes', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
    mockBytesDecoder.receivePart.mockReturnValue(true);
    mockBytesDecoder.estimatedPercentComplete.mockReturnValue(0.33);
    mockBytesDecoder.expectedPartCount.mockReturnValue(3);
    mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
    mockBytesDecoder.isComplete.mockReturnValue(false);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:bytes/1-3/...' }]);
    });

    expect(result.current.urProgress).toBe(33);
    expect(result.current.scanResult).toBeNull();
  });

  it('should handle ur:bytes decode failure', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
    mockBytesDecoder.receivePart.mockReturnValue(true);
    mockBytesDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockBytesDecoder.expectedPartCount.mockReturnValue(1);
    mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
    mockBytesDecoder.isComplete.mockReturnValue(true);
    mockBytesDecoder.isSuccess.mockReturnValue(false);
    mockBytesDecoder.resultError.mockReturnValue('Bytes decode error');

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:bytes/...' }]);
    });

    expect(result.current.error).toContain('UR bytes decode failed');
  });

  it('should handle ur:bytes content extraction failure', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
    mockBytesDecoder.receivePart.mockReturnValue(true);
    mockBytesDecoder.estimatedPercentComplete.mockReturnValue(1);
    mockBytesDecoder.expectedPartCount.mockReturnValue(1);
    mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
    mockBytesDecoder.isComplete.mockReturnValue(true);
    mockBytesDecoder.isSuccess.mockReturnValue(true);
    mockBytesDecoder.resultUR.mockReturnValue({
      decodeCBOR: () => new TextEncoder().encode('invalid'),
    });
    (extractFromUrBytesContent as ReturnType<typeof vi.fn>).mockReturnValue(null);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:bytes/...' }]);
    });

    expect(result.current.error).toContain('Could not extract xpub from ur:bytes');
  });
}
