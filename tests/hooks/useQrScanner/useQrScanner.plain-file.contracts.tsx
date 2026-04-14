import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { renderUseQrScanner } from './useQrScannerTestHarness';
import { parseDeviceJson } from '../../../services/deviceParsers';

export function registerPlainJsonQrScanningContracts() {
  it('should parse plain JSON QR code successfully', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKi...',
      fingerprint: 'ABCD1234',
      derivationPath: "m/84'/0'/0'",
      label: 'My Device',
      format: 'coldcard',
    });

    act(() => {
      result.current.setCameraActive(true);
      result.current.handleQrScan([
        { rawValue: '{"xpub": "xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKi..."}' },
      ]);
    });

    expect(result.current.cameraActive).toBe(false);
    expect(result.current.scanResult).not.toBeNull();
    expect(result.current.scanResult?.xpub).toBe('xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKi...');
    expect(result.current.scanResult?.fingerprint).toBe('ABCD1234');
    expect(result.current.scanResult?.derivationPath).toBe("m/84'/0'/0'");
    expect(result.current.error).toBeNull();
  });

  it('should handle plain JSON with multiple accounts', () => {
    const { result } = renderUseQrScanner();

    const accounts = [
      {
        xpub: 'xpub1...',
        derivationPath: "m/84'/0'/0'",
        purpose: 'single_sig' as const,
        scriptType: 'native_segwit' as const,
      },
      {
        xpub: 'xpub2...',
        derivationPath: "m/48'/0'/0'/2'",
        purpose: 'multisig' as const,
        scriptType: 'native_segwit' as const,
      },
    ];

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub1...',
      fingerprint: 'ABCD1234',
      derivationPath: "m/84'/0'/0'",
      accounts,
      format: 'coldcard',
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: '{"accounts": [...]}' }]);
    });

    expect(result.current.scanResult?.accounts).toEqual(accounts);
  });

  it('should handle unparseable JSON QR code', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'not valid json or xpub data' }]);
    });

    expect(result.current.error).toContain('Could not find xpub');
    expect(result.current.scanResult).toBeNull();
    expect(result.current.scanning).toBe(false);
  });

  it('uses fallback unknown error when plain scan throws non-Error values', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw 'non-error-scan-failure';
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'raw-content' }]);
    });

    expect(result.current.error).toBe('Unknown error');
    expect(result.current.scanning).toBe(false);
  });

  it('should ignore empty scan results', () => {
    const { result } = renderUseQrScanner();

    act(() => {
      result.current.handleQrScan([]);
    });

    expect(result.current.scanResult).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should ignore null scan results', () => {
    const { result } = renderUseQrScanner();

    act(() => {
      // @ts-expect-error - Testing null handling
      result.current.handleQrScan(null);
    });

    expect(result.current.scanResult).toBeNull();
    expect(result.current.error).toBeNull();
  });
}

export function registerFileContentHandlingContracts() {
  it('should process file content successfully', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6FileContent...',
      fingerprint: 'FILE1234',
      derivationPath: "m/84'/0'/0'",
      format: 'generic',
    });

    act(() => {
      result.current.handleFileContent('{"xpub": "xpub6FileContent..."}');
    });

    expect(result.current.scanResult?.xpub).toBe('xpub6FileContent...');
    expect(result.current.scanResult?.fingerprint).toBe('FILE1234');
    expect(result.current.error).toBeNull();
  });

  it('should handle file content parsing error', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

    act(() => {
      result.current.handleFileContent('invalid content');
    });

    expect(result.current.error).toContain('Could not find xpub');
    expect(result.current.scanResult).toBeNull();
    expect(result.current.scanning).toBe(false);
  });

  it('uses fallback unknown error when file parsing throws non-Error values', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw 'non-error-file-failure';
    });

    act(() => {
      result.current.handleFileContent('raw file content');
    });

    expect(result.current.error).toBe('Unknown error');
    expect(result.current.scanning).toBe(false);
  });
}
