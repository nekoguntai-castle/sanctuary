import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hardwareWallet: {
    isConnected: true,
    device: { id: 'hw-1', type: 'trezor', name: 'Trezor Safe 3' } as unknown,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signPSBT: vi.fn(),
  },
  updateDraft: vi.fn(),
}));

vi.mock('../../src/hooks/useHardwareWallet', () => ({
  useHardwareWallet: () => mocks.hardwareWallet,
}));

vi.mock('../../src/api/drafts', () => ({
  updateDraft: mocks.updateDraft,
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { useUsbSigning } from '../../src/hooks/send/useUsbSigning';
import { testPsbtSigningContext } from '../fixtures/psbtSigningContext';

const txData = {
  psbtBase64: 'unsigned-psbt',
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
  fee: 123,
  totalInput: 10123,
  totalOutput: 10000,
  changeAmount: 0,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
  signingContext: testPsbtSigningContext,
};

const trezor = {
  id: 'device-1',
  type: 'Trezor Safe 3',
  label: 'Trezor',
  model: { name: 'Trezor Safe 3' },
  fingerprint: 'aabbccdd',
} as never;

function createDeps(overrides: Partial<Parameters<typeof useUsbSigning>[0]> = {}): Parameters<typeof useUsbSigning>[0] {
  const controller = new AbortController();
  return {
    walletId: 'wallet-1',
    wallet: { id: 'wallet-1', type: 'single_sig', name: 'Primary Wallet', network: 'mainnet' } as never,
    draftId: null,
    txData,
    unsignedPsbt: 'unsigned-psbt',
    setIsSigning: vi.fn(),
    setError: vi.fn(),
    setUnsignedPsbt: vi.fn(),
    setSignedRawTx: vi.fn(),
    setSignedDevices: vi.fn(),
    beginSigning: () => ({ signal: controller.signal, isCurrent: () => true }),
    ...overrides,
  };
}

describe('useUsbSigning payjoin dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hardwareWallet.isConnected = true;
    mocks.hardwareWallet.device = { id: 'hw-1', type: 'trezor', name: 'Trezor Safe 3' };
    mocks.hardwareWallet.connect.mockResolvedValue(undefined);
    mocks.hardwareWallet.signPSBT.mockResolvedValue({ psbt: 'signed-psbt' });
  });

  it('clears the uploaded-artifact origin after signWithHardwareWallet', async () => {
    const onUsbSigned = vi.fn();
    const { result } = renderHook(() => useUsbSigning(createDeps({ onUsbSigned })));

    await act(async () => {
      expect(await result.current.signWithHardwareWallet()).toBe('signed-psbt');
    });

    expect(onUsbSigned).toHaveBeenCalledTimes(1);
  });

  it('clears the origin after signWithHardwareWalletResult, the connected-device broadcast path', async () => {
    const onUsbSigned = vi.fn();
    const { result } = renderHook(() => useUsbSigning(createDeps({ onUsbSigned })));

    await act(async () => {
      expect(await result.current.signWithHardwareWalletResult()).toEqual({ psbt: 'signed-psbt' });
    });

    expect(onUsbSigned).toHaveBeenCalledTimes(1);
  });

  it('does not clear the origin when the device produced nothing applicable', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({});
    const onUsbSigned = vi.fn();
    const { result } = renderHook(() => useUsbSigning(createDeps({ onUsbSigned })));

    await act(async () => {
      expect(await result.current.signWithHardwareWalletResult()).toBeNull();
    });

    expect(onUsbSigned).not.toHaveBeenCalled();
  });

  it('clears the origin after signWithDevice', async () => {
    const onUsbSigned = vi.fn();
    const { result } = renderHook(() => useUsbSigning(createDeps({ onUsbSigned })));

    await act(async () => {
      expect(await result.current.signWithDevice(trezor)).toBe(true);
    });

    expect(onUsbSigned).toHaveBeenCalledTimes(1);
  });

  it('refuses signWithDevice during payjoin round two without touching the device', async () => {
    const onUsbSigned = vi.fn();
    const deps = createDeps({ onUsbSigned, isRoundTwoLocked: () => true });
    const { result } = renderHook(() => useUsbSigning(deps));

    await act(async () => {
      expect(await result.current.signWithDevice(trezor)).toBe(false);
    });

    expect(deps.setError).toHaveBeenCalledWith(
      'Sign the payjoin proposal with a PSBT file or QR code; USB signing is not available for it',
    );
    expect(mocks.hardwareWallet.connect).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
    expect(onUsbSigned).not.toHaveBeenCalled();
  });

  it('signs with the device when round two is not locked', async () => {
    const { result } = renderHook(() => useUsbSigning(createDeps({ isRoundTwoLocked: () => false })));

    await act(async () => {
      expect(await result.current.signWithDevice(trezor)).toBe(true);
    });

    expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalledTimes(1);
  });

  it('does not clear the origin when signWithDevice lost its lease while persisting the signature', async () => {
    const onUsbSigned = vi.fn();
    const controller = new AbortController();
    let current = true;
    mocks.updateDraft.mockImplementationOnce(async () => { current = false; });
    const deps = createDeps({
      onUsbSigned,
      draftId: 'draft-1',
      beginSigning: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await act(async () => {
      expect(await result.current.signWithDevice(trezor)).toBe(false);
    });

    expect(onUsbSigned).not.toHaveBeenCalled();
  });

  it('refuses signWithHardwareWalletResult during payjoin round two without touching the device', async () => {
    const onUsbSigned = vi.fn();
    const beginSigning = vi.fn();
    const deps = createDeps({ onUsbSigned, beginSigning, isRoundTwoLocked: () => true });
    const { result } = renderHook(() => useUsbSigning(deps));

    await act(async () => {
      expect(await result.current.signWithHardwareWalletResult()).toBeNull();
    });

    expect(deps.setError).toHaveBeenCalledWith(
      'Sign the payjoin proposal with a PSBT file or QR code; USB signing is not available for it',
    );
    expect(beginSigning).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
    expect(onUsbSigned).not.toHaveBeenCalled();
  });
});
