import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hardwareWallet: {
    isConnected: false,
    device: null as unknown,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signPSBT: vi.fn(),
  },
  updateDraft: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../hooks/useHardwareWallet', () => ({
  useHardwareWallet: () => mocks.hardwareWallet,
}));

vi.mock('../../src/api/drafts', () => ({
  updateDraft: mocks.updateDraft,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

import { useUsbSigning } from '../../hooks/send/useUsbSigning';

const descriptorWithXpub =
  'wsh(sortedmulti(2,[A1B2C3D4/48h/0h/0h/2h]xpub123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz/0/*))';

const baseTxData = {
  psbtBase64: 'unsigned-psbt',
  fee: 123,
  totalInput: 10123,
  totalOutput: 10000,
  changeAmount: 0,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
  outputs: [{ address: 'bc1qrecipient', amount: 10000 }],
  inputPaths: ["m/84'/0'/0'/0/0"],
} as any;

function createDeps(overrides: Partial<Parameters<typeof useUsbSigning>[0]> = {}) {
  return {
    walletId: 'wallet-1',
    wallet: { id: 'wallet-1', type: 'single_sig', name: 'Primary Wallet' } as any,
    draftId: null,
    txData: baseTxData,
    unsignedPsbt: 'unsigned-psbt',
    setIsSigning: vi.fn(),
    setError: vi.fn(),
    setUnsignedPsbt: vi.fn(),
    setSignedRawTx: vi.fn(),
    setSignedDevices: vi.fn(),
    ...overrides,
  };
}

describe('useUsbSigning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hardwareWallet.isConnected = true;
    mocks.hardwareWallet.device = { id: 'hw-1' };
    mocks.hardwareWallet.connect.mockResolvedValue(undefined);
    mocks.hardwareWallet.disconnect.mockImplementation(() => undefined);
    mocks.hardwareWallet.signPSBT.mockResolvedValue({ psbt: 'signed-psbt' });
    mocks.updateDraft.mockResolvedValue(undefined);
  });

  it('signWithHardwareWallet supports multisig xpub extraction and returns rawTx fallback', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({ rawTx: 'rawtx-hex' });
    const deps = createDeps({
      wallet: {
        id: 'wallet-1',
        type: 'multi_sig',
        descriptor: descriptorWithXpub,
      } as any,
      txData: {
        ...baseTxData,
        inputPaths: undefined,
      } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    let signed: string | null = null;
    await act(async () => {
      signed = await result.current.signWithHardwareWallet();
    });

    expect(signed).toBe('rawtx-hex');
    expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalledWith(
      'unsigned-psbt',
      [],
      expect.objectContaining({
        a1b2c3d4: expect.stringContaining('xpub'),
      })
    );
  });

  it('signWithHardwareWallet surfaces Error message on failure', async () => {
    mocks.hardwareWallet.signPSBT.mockRejectedValueOnce(new Error('hardware failed'));
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let signed: string | null = 'placeholder';
    await act(async () => {
      signed = await result.current.signWithHardwareWallet();
    });

    expect(signed).toBeNull();
    expect(deps.setError).toHaveBeenCalledWith('hardware failed');
  });

  it('signWithHardwareWallet uses fallback message for non-Error failures', async () => {
    mocks.hardwareWallet.signPSBT.mockRejectedValueOnce('bad failure');
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let signed: string | null = 'placeholder';
    await act(async () => {
      signed = await result.current.signWithHardwareWallet();
    });

    expect(signed).toBeNull();
    expect(deps.setError).toHaveBeenCalledWith('Hardware wallet signing failed');
  });

  it('signWithHardwareWallet returns null when signer returns no psbt/rawTx', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({});
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let signed: string | null = 'placeholder';
    await act(async () => {
      signed = await result.current.signWithHardwareWallet();
    });

    expect(signed).toBeNull();
  });

  it('signWithDevice fails when no PSBT is available', async () => {
    const deps = createDeps({
      txData: null,
      unsignedPsbt: null,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({ id: 'dev-1', type: 'Trezor Safe 3' } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('No PSBT available to sign');
  });

  it('signWithDevice accepts rawTx-only result and tolerates draft persistence failures', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({ rawTx: 'rawtx-from-device' });
    mocks.updateDraft.mockRejectedValueOnce(new Error('persist failed'));

    const deps = createDeps({
      draftId: 'draft-1',
      txData: {
        ...baseTxData,
        inputPaths: undefined,
      } as any,
      unsignedPsbt: 'unsigned-psbt',
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.signWithDevice({ id: 'dev-1', type: 'Trezor Safe 3' } as any);
    });

    expect(ok).toBe(true);
    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('unsigned-psbt');
    expect(deps.setSignedRawTx).toHaveBeenCalledWith('rawtx-from-device');
    const updater = vi.mocked(deps.setSignedDevices).mock.calls[0][0];
    const signedSet = updater(new Set<string>());
    expect(signedSet.has('dev-1')).toBe(true);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to persist signature to draft',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(mocks.hardwareWallet.disconnect).toHaveBeenCalled();
  });

  it('signWithDevice signs multisig PSBT with descriptor xpubs and no draft persistence', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({ psbt: 'multisig-signed-psbt' });
    const deps = createDeps({
      wallet: {
        id: 'wallet-1',
        type: 'multi_sig',
        descriptor: descriptorWithXpub,
      } as any,
      draftId: null,
      txData: {
        ...baseTxData,
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      } as any,
      unsignedPsbt: 'unsigned-multisig-psbt',
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.signWithDevice({ id: 'dev-multi', type: 'Trezor Safe 3' } as any);
    });

    expect(ok).toBe(true);
    expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalledWith(
      'unsigned-multisig-psbt',
      ["m/48'/0'/0'/2'/0/0"],
      expect.objectContaining({
        a1b2c3d4: expect.stringContaining('xpub'),
      })
    );
    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('multisig-signed-psbt');
    expect(deps.setSignedRawTx).not.toHaveBeenCalled();
    expect(mocks.updateDraft).not.toHaveBeenCalled();
  });

  it('signWithDevice reports missing signing result when device returns neither psbt nor rawTx', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({});
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({ id: 'dev-2', type: 'Trezor Safe 3' } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('Signing did not produce a result');
    expect(mocks.hardwareWallet.disconnect).toHaveBeenCalled();
  });

  it('signWithDevice surfaces Error message when signing throws Error', async () => {
    mocks.hardwareWallet.signPSBT.mockRejectedValueOnce(new Error('device signing failed'));
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({ id: 'dev-3', type: 'Trezor Safe 3' } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('device signing failed');
  });

  it('signWithDevice uses fallback error for non-Error thrown values', async () => {
    mocks.hardwareWallet.signPSBT.mockRejectedValueOnce('bad');
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({ id: 'dev-4', type: 'Trezor Safe 3' } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('Failed to sign with device');
  });
});
