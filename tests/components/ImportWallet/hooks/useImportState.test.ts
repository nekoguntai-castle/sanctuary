import { act,renderHook } from '@testing-library/react';
import { describe,expect,it } from 'vitest';
import { createElement, StrictMode, type ReactNode } from 'react';
import { useImportState } from '../../../../src/components/ImportWallet/hooks/useImportState';
import type { TabNetwork } from '../../../../src/app/networks';

describe('useImportState', () => {
  it('resets validation state via resetValidation', () => {
    const { result } = renderHook(() => useImportState());

    act(() => {
      result.current.setValidationResult({
        walletNameSuggestion: 'Imported Wallet',
      } as any);
      result.current.setValidationError('validation failed');
    });

    expect(result.current.validationResult).not.toBeNull();
    expect(result.current.validationError).toBe('validation failed');

    act(() => {
      result.current.resetValidation();
    });

    expect(result.current.validationResult).toBeNull();
    expect(result.current.validationError).toBeNull();
  });

  it('synchronously resets all network-owned state and advances a monotonic generation', () => {
    const { result, rerender } = renderHook(
      ({ network }) => useImportState(network),
      { initialProps: { network: 'mainnet' as TabNetwork } },
    );

    act(() => {
      result.current.setStep(4);
      result.current.setFormat('hardware');
      result.current.setImportData('old descriptor');
      result.current.setWalletName('old suggestion');
      result.current.setValidationResult({ valid: true } as any);
      result.current.setIsValidating(true);
      result.current.setValidationError('old validation error');
      result.current.setIsImporting(true);
      result.current.setImportError('old import error');
      result.current.setDeviceConnected(true);
      result.current.setDeviceLabel('old device');
      result.current.setXpubData({ xpub: 'old', fingerprint: 'old', path: 'old' });
      result.current.setIsFetchingXpub(true);
      result.current.setIsConnecting(true);
      result.current.setHardwareError('old hardware error');
      result.current.setCameraActive(true);
      result.current.setCameraError('old camera error');
      result.current.setUrProgress(50);
      result.current.setQrScanned(true);
      result.current.bytesDecoderRef.current = {} as any;
    });

    const mainnetOwner = result.current.getNetworkOwner();
    rerender({ network: 'testnet3' });

    expect(result.current.network).toBe('testnet3');
    expect(result.current.step).toBe(1);
    expect(result.current.format).toBeNull();
    expect(result.current.importData).toBe('');
    expect(result.current.walletName).toBe('');
    expect(result.current.validationResult).toBeNull();
    expect(result.current.isValidating).toBe(false);
    expect(result.current.validationError).toBeNull();
    expect(result.current.isImporting).toBe(false);
    expect(result.current.importError).toBeNull();
    expect(result.current.deviceConnected).toBe(false);
    expect(result.current.deviceLabel).toBeNull();
    expect(result.current.xpubData).toBeNull();
    expect(result.current.isFetchingXpub).toBe(false);
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.hardwareError).toBeNull();
    expect(result.current.cameraActive).toBe(false);
    expect(result.current.cameraError).toBeNull();
    expect(result.current.urProgress).toBe(0);
    expect(result.current.qrScanned).toBe(false);
    expect(result.current.bytesDecoderRef.current).toBeNull();
    expect(result.current.isNetworkOwnerCurrent(mainnetOwner)).toBe(false);

    const testnetOwner = result.current.getNetworkOwner();
    rerender({ network: 'mainnet' });
    expect(result.current.isNetworkOwnerCurrent(mainnetOwner)).toBe(false);
    expect(result.current.isNetworkOwnerCurrent(testnetOwner)).toBe(false);
    expect(result.current.getNetworkOwner().generation).toBeGreaterThan(testnetOwner.generation);
  });

  it('invalidates async owners on unmount', () => {
    const { result, unmount } = renderHook(() => useImportState('mainnet'));
    const owner = result.current.getNetworkOwner();

    unmount();

    expect(result.current.isNetworkOwnerCurrent(owner)).toBe(false);
  });

  it('keeps the rendered owner current across StrictMode effect replay', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      createElement(StrictMode, null, children)
    );
    const { result } = renderHook(() => useImportState('mainnet'), { wrapper });
    const owner = result.current.getNetworkOwner();

    expect(result.current.isNetworkOwnerCurrent(owner)).toBe(true);
  });
});
