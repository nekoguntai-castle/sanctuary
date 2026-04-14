import { act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import {
  mockUrRegistryDecoder,
  renderUseQrScanner,
} from './useQrScannerTestHarness';
import { parseDeviceJson } from '../../../services/deviceParsers';
import { generateMissingFieldsWarning } from '../../../utils/deviceConnection';
import { getUrType } from '../../../utils/urDeviceDecoder';

export function registerExtractedFieldsAndWarningsContracts() {
  it('should set extractedFields correctly for complete data', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6Complete...',
      fingerprint: 'COMP1234',
      derivationPath: "m/84'/0'/0'",
      label: 'My Wallet',
      format: 'generic',
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: '{"complete": "data"}' }]);
    });

    expect(result.current.scanResult?.extractedFields).toEqual({
      xpub: true,
      fingerprint: true,
      derivationPath: true,
      label: true,
    });
  });

  it('should set extractedFields correctly for partial data', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6Partial...',
      fingerprint: '',
      derivationPath: '',
      format: 'generic',
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: '{"partial": "data"}' }]);
    });

    expect(result.current.scanResult?.extractedFields).toEqual({
      xpub: true,
      fingerprint: false,
      derivationPath: false,
      label: false,
    });
  });

  it('should include warning for missing fields', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6...',
      fingerprint: '',
      derivationPath: '',
      format: 'generic',
    });
    (generateMissingFieldsWarning as ReturnType<typeof vi.fn>).mockReturnValue(
      'Missing fingerprint and derivation path'
    );

    act(() => {
      result.current.handleQrScan([{ rawValue: '{}' }]);
    });

    expect(result.current.scanResult?.warning).toBe(
      'Missing fingerprint and derivation path'
    );
  });

  it('should have no warning when all fields present', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6...',
      fingerprint: 'ABCD1234',
      derivationPath: "m/84'/0'/0'",
      format: 'generic',
    });
    (generateMissingFieldsWarning as ReturnType<typeof vi.fn>).mockReturnValue(null);

    act(() => {
      result.current.handleQrScan([{ rawValue: '{}' }]);
    });

    expect(result.current.scanResult?.warning).toBeNull();
  });

  it('should uppercase fingerprint', () => {
    const { result } = renderUseQrScanner();

    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6...',
      fingerprint: 'abcd1234',
      derivationPath: "m/84'/0'/0'",
      format: 'generic',
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: '{}' }]);
    });

    expect(result.current.scanResult?.fingerprint).toBe('ABCD1234');
  });
}

export function registerErrorRecoveryContracts() {
  it('should clear error on successful scan after error', () => {
    const { result } = renderUseQrScanner();

    // First, cause an error
    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'bad data' }]);
    });

    expect(result.current.error).not.toBeNull();

    // Now succeed
    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
      xpub: 'xpub6Success...',
      fingerprint: 'SUCC1234',
      derivationPath: "m/84'/0'/0'",
      format: 'generic',
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'good data' }]);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.scanResult?.xpub).toBe('xpub6Success...');
  });

  it('should reset decoders on error', () => {
    const { result } = renderUseQrScanner();

    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
    mockUrRegistryDecoder.receivePart.mockImplementation(() => {
      throw new Error('Decoder exception');
    });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/...' }]);
    });

    expect(result.current.error).toContain('Decoder exception');
    expect(result.current.urProgress).toBe(0);
    expect(result.current.scanning).toBe(false);
  });
}
