import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import {
  mockBbqrDecoder,
  renderUseQrScanner,
} from './useQrScannerTestHarness';
import { isBBQr } from '../../../services/bbqr';
import { parseDeviceJson } from '../../../services/deviceParsers';

export function registerBbqrFormatProcessingContracts() {
  it('should detect and process BBQr JSON format', () => {
    const { result } = renderUseQrScanner();

    (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockBbqrDecoder.receivePart.mockReturnValue(true);
    mockBbqrDecoder.getProgress.mockReturnValue(100);
    mockBbqrDecoder.getReceivedCount.mockReturnValue(1);
    mockBbqrDecoder.getTotalParts.mockReturnValue(1);
    mockBbqrDecoder.getFileType.mockReturnValue('J');
    mockBbqrDecoder.isComplete.mockReturnValue(true);
    mockBbqrDecoder.decode.mockReturnValue({
      data: new Uint8Array(),
      fileType: 'J',
      text: '{"xpub": "xpub6BBQr..."}',
    });
    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6BBQr...',
      fingerprint: 'BBQR1234',
      derivationPath: "m/84'/0'/0'",
      format: 'coldcard',
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'B$2J01...' }]);
    });

    expect(result.current.scanResult?.xpub).toBe('xpub6BBQr...');
    expect(result.current.scanResult?.fingerprint).toBe('BBQR1234');
  });

  it('should track progress for multi-part BBQr', () => {
    const { result } = renderUseQrScanner();

    (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockBbqrDecoder.receivePart.mockReturnValue(true);
    mockBbqrDecoder.getProgress.mockReturnValue(50);
    mockBbqrDecoder.getReceivedCount.mockReturnValue(2);
    mockBbqrDecoder.getTotalParts.mockReturnValue(4);
    mockBbqrDecoder.getFileType.mockReturnValue('J');
    mockBbqrDecoder.isComplete.mockReturnValue(false);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'B$2J04...' }]);
    });

    expect(result.current.urProgress).toBe(50);
    expect(result.current.scanResult).toBeNull();
  });

  it('should handle BBQr part rejection', () => {
    const { result } = renderUseQrScanner();

    (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockBbqrDecoder.receivePart.mockReturnValue(false);
    mockBbqrDecoder.getError.mockReturnValue('Invalid BBQr part');

    act(() => {
      result.current.handleQrScan([{ rawValue: 'B$2J01invalid...' }]);
    });

    expect(result.current.error).toContain('BBQr error');
  });

  it('should reject non-JSON BBQr file types', () => {
    const { result } = renderUseQrScanner();

    (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockBbqrDecoder.receivePart.mockReturnValue(true);
    mockBbqrDecoder.getProgress.mockReturnValue(100);
    mockBbqrDecoder.getReceivedCount.mockReturnValue(1);
    mockBbqrDecoder.getTotalParts.mockReturnValue(1);
    mockBbqrDecoder.getFileType.mockReturnValue('P');
    mockBbqrDecoder.isComplete.mockReturnValue(true);
    mockBbqrDecoder.decode.mockReturnValue({
      data: new Uint8Array(),
      fileType: 'P',
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'B$2P01...' }]);
    });

    expect(result.current.error).toContain('not supported for device import');
    expect(result.current.error).toContain('JSON export format');
  });

  it('should handle BBQr JSON parsing failure', () => {
    const { result } = renderUseQrScanner();

    (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockBbqrDecoder.receivePart.mockReturnValue(true);
    mockBbqrDecoder.getProgress.mockReturnValue(100);
    mockBbqrDecoder.getReceivedCount.mockReturnValue(1);
    mockBbqrDecoder.getTotalParts.mockReturnValue(1);
    mockBbqrDecoder.getFileType.mockReturnValue('J');
    mockBbqrDecoder.isComplete.mockReturnValue(true);
    mockBbqrDecoder.decode.mockReturnValue({
      data: new Uint8Array(),
      fileType: 'J',
      text: '{"invalid": "no xpub"}',
    });
    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'B$2J01...' }]);
    });

    expect(result.current.error).toContain('Could not extract xpub from BBQr JSON');
  });
}
