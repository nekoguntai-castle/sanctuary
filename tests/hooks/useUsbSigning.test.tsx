import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

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

vi.mock('../../src/hooks/useHardwareWallet', () => ({
  useHardwareWallet: () => mocks.hardwareWallet,
}));

vi.mock('../../src/api/drafts', () => ({
  updateDraft: mocks.updateDraft,
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

import { useUsbSigning } from '../../src/hooks/send/useUsbSigning';
import { testPsbtSigningContext } from '../fixtures/psbtSigningContext';

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
  signingContext: testPsbtSigningContext,
} as any;

function createDeps(
  overrides: Partial<Parameters<typeof useUsbSigning>[0]> = {}
): Parameters<typeof useUsbSigning>[0] {
  const controller = new AbortController();
  return {
    walletId: 'wallet-1',
    wallet: {
      id: 'wallet-1',
      type: 'single_sig',
      name: 'Primary Wallet',
    } as any,
    draftId: null,
    txData: baseTxData,
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

  it('signWithHardwareWallet supports multisig xpub extraction and returns the applied PSBT', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({
      psbt: 'signed-multisig-psbt',
    });
    mocks.hardwareWallet.device = {
      id: 'hw-1',
      type: 'trezor',
      name: 'Trezor Safe 3',
    };
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

    expect(signed).toBe('signed-multisig-psbt');
    expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalledWith(
      'unsigned-psbt',
      testPsbtSigningContext,
      expect.objectContaining({
        a1b2c3d4: expect.stringContaining('xpub'),
      })
    );
  });

  it('signs an explicitly supplied just-created transaction through the signing owner', async () => {
    const deps = createDeps({ txData: null });
    const { result } = renderHook(() => useUsbSigning(deps));
    const justCreated = {
      ...baseTxData,
      psbtBase64: 'just-created-psbt',
      inputPaths: ["m/84'/0'/0'/1/0"],
    } as any;

    await expect(result.current.signWithHardwareWalletResult(justCreated)).resolves.toEqual({
      psbt: 'signed-psbt',
    });

    expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalledWith(
      'just-created-psbt',
      testPsbtSigningContext,
      undefined
    );
    expect(deps.setIsSigning).toHaveBeenNthCalledWith(1, true);
    expect(deps.setIsSigning).toHaveBeenLastCalledWith(false);
  });

  it('signWithHardwareWallet reports missing connection state', async () => {
    mocks.hardwareWallet.isConnected = false;
    mocks.hardwareWallet.device = null;
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(result.current.signWithHardwareWallet()).resolves.toBeNull();

    expect(deps.setError).toHaveBeenCalledWith(
      'Hardware wallet not connected or no transaction to sign'
    );
  });

  it('reports a missing transaction when the connected-wallet wrapper has no current data', async () => {
    const deps = createDeps({ txData: null });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(result.current.signWithHardwareWallet()).resolves.toBeNull();
    expect(deps.setError).toHaveBeenCalledWith(
      'Hardware wallet not connected or no transaction to sign'
    );
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
  });

  it('signWithHardwareWallet blocks Ledger multisig USB signing before signer calls', async () => {
    mocks.hardwareWallet.device = {
      id: 'ledger-1',
      type: 'ledger',
      name: 'Ledger Nano X',
    };
    const deps = createDeps({
      wallet: {
        id: 'wallet-1',
        type: 'multi_sig',
        descriptor: descriptorWithXpub,
      } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    let signed: string | null = 'placeholder';
    await act(async () => {
      signed = await result.current.signWithHardwareWallet();
    });

    expect(signed).toBeNull();
    expect(deps.setError).toHaveBeenCalledWith(
      expect.stringContaining('Ledger Nano X multisig USB signing is blocked in this release.')
    );
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
    expect(deps.setIsSigning).not.toHaveBeenCalled();
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

  it('signWithHardwareWallet returns null when signer returns no signed artifact', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({});
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let signed: string | null = 'placeholder';
    await act(async () => {
      signed = await result.current.signWithHardwareWallet();
    });

    expect(signed).toBeNull();
  });

  it('rejects an artifact-only Trezor result because it cannot advance signing state', async () => {
    const trezorArtifact = {
      type: 'trezor-connect-transaction',
      sourcePsbt: 'unsigned-psbt',
      connectSignatures: ['300102'],
      serializedTx: 'rawtx-hex',
    } as const;
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({ trezorArtifact });
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(result.current.signWithHardwareWalletResult()).resolves.toBeNull();
    expect(deps.setError).toHaveBeenCalledWith(
      'Hardware signing proof did not produce an applicable signed PSBT or transaction'
    );
  });

  it('does not mark or persist a device when Trezor returns evidence only', async () => {
    const trezorArtifact = {
      type: 'trezor-connect-transaction',
      sourcePsbt: 'unsigned-psbt',
      connectSignatures: ['300102'],
      serializedTx: 'rawtx-hex',
    } as const;
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({ trezorArtifact });
    const deps = createDeps({ draftId: 'draft-1' });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(
      result.current.signWithDevice({
        id: 'trezor-1',
        type: 'Trezor Safe 3',
      } as any)
    ).resolves.toBe(false);

    expect(deps.setUnsignedPsbt).not.toHaveBeenCalled();
    expect(deps.setSignedRawTx).not.toHaveBeenCalled();
    expect(deps.setSignedDevices).not.toHaveBeenCalled();
    expect(mocks.updateDraft).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith(
      'Hardware signing proof did not produce an applicable signed PSBT or transaction'
    );
  });

  it('does not mark a multisig device when the adapter returns only a raw transaction', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({
      rawTx: 'rawtx-from-device',
    });
    const deps = createDeps({
      wallet: {
        id: 'wallet-1',
        type: 'multi_sig',
        descriptor: descriptorWithXpub,
      } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(
      result.current.signWithDevice({
        id: 'trezor-1',
        type: 'Trezor Safe 3',
      } as any)
    ).resolves.toBe(false);

    expect(deps.setUnsignedPsbt).not.toHaveBeenCalled();
    expect(deps.setSignedRawTx).not.toHaveBeenCalled();
    expect(deps.setSignedDevices).not.toHaveBeenCalled();
  });

  it('signWithHardwareWallet refuses a transaction without server-issued signing context', async () => {
    const deps = createDeps({
      txData: { ...baseTxData, signingContext: undefined } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(result.current.signWithHardwareWallet()).resolves.toBeNull();

    expect(deps.setError).toHaveBeenCalledWith(
      'This transaction has no server-issued hardware signing context; recreate it before signing'
    );
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
  });

  it('signWithHardwareWallet refuses signing without current transaction ownership', async () => {
    const deps = createDeps({ beginSigning: () => null });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(result.current.signWithHardwareWallet()).resolves.toBeNull();

    expect(deps.setError).toHaveBeenCalledWith(
      'Transaction changed; review it again before signing'
    );
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
  });

  it('signWithHardwareWallet ignores stale success and stale failure completions', async () => {
    let current = true;
    const controller = new AbortController();
    const deps = createDeps({
      beginSigning: () => ({
        signal: controller.signal,
        isCurrent: () => current,
      }),
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    mocks.hardwareWallet.signPSBT.mockImplementationOnce(async () => {
      current = false;
      return { psbt: 'stale-psbt' };
    });
    await expect(result.current.signWithHardwareWallet()).resolves.toBeNull();

    current = true;
    mocks.hardwareWallet.signPSBT.mockImplementationOnce(async () => {
      current = false;
      throw new Error('stale failure');
    });
    await expect(result.current.signWithHardwareWallet()).resolves.toBeNull();

    expect(deps.setError).toHaveBeenCalledTimes(2);
    expect(deps.setError).toHaveBeenNthCalledWith(1, null);
    expect(deps.setError).toHaveBeenNthCalledWith(2, null);
    expect(deps.setIsSigning).toHaveBeenCalledTimes(2);
  });

  it('signWithDevice fails when no PSBT is available', async () => {
    const deps = createDeps({
      txData: null,
      unsignedPsbt: null,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'dev-1',
        type: 'Trezor Safe 3',
      } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('No PSBT available to sign');
  });

  it('signWithDevice fails for unsupported device types before connecting', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'dev-unknown',
        type: 'Unknown Hardware',
      } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(
      'Unsupported device type: Unknown Hardware. Use PSBT file signing instead.'
    );
    expect(mocks.hardwareWallet.connect).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.disconnect).not.toHaveBeenCalled();
  });

  it('signWithDevice fails for devices that do not support USB signing', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'dev-coldcard',
        type: 'Coldcard Mk4',
      } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(
      'Coldcard Mk4 does not support USB signing. Please use PSBT file signing.'
    );
    expect(mocks.hardwareWallet.connect).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.disconnect).not.toHaveBeenCalled();
  });

  it('signWithDevice blocks BitBox multisig USB signing before connecting', async () => {
    const deps = createDeps({
      wallet: {
        id: 'wallet-1',
        type: 'multi_sig',
        descriptor: descriptorWithXpub,
      } as any,
      txData: {
        ...baseTxData,
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'bitbox-1',
        type: 'BitBox02',
        label: 'Treasury BitBox',
      } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(
      expect.stringContaining('Treasury BitBox multisig USB signing is blocked in this release.')
    );
    expect(mocks.hardwareWallet.connect).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.disconnect).not.toHaveBeenCalled();
  });

  it('signWithDevice uses device type when a blocked multisig signer has no label', async () => {
    const deps = createDeps({
      wallet: {
        id: 'wallet-1',
        type: 'multi_sig',
        descriptor: descriptorWithXpub,
      } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'ledger-1',
        type: 'Ledger Nano X',
      } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(
      expect.stringContaining('Ledger Nano X multisig USB signing is blocked in this release.')
    );
    expect(mocks.hardwareWallet.connect).not.toHaveBeenCalled();
  });

  it('signWithDevice accepts rawTx-only result and tolerates draft persistence failures', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({
      rawTx: 'rawtx-from-device',
    });
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
      ok = await result.current.signWithDevice({
        id: 'dev-1',
        type: 'Trezor Safe 3',
      } as any);
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
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({
      psbt: 'multisig-signed-psbt',
    });
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
      ok = await result.current.signWithDevice({
        id: 'dev-multi',
        type: 'Trezor Safe 3',
      } as any);
    });

    expect(ok).toBe(true);
    expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalledWith(
      'unsigned-multisig-psbt',
      testPsbtSigningContext,
      expect.objectContaining({
        a1b2c3d4: expect.stringContaining('xpub'),
      })
    );
    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('multisig-signed-psbt');
    expect(deps.setSignedRawTx).not.toHaveBeenCalled();
    expect(mocks.updateDraft).not.toHaveBeenCalled();
  });

  it('signWithDevice refuses a PSBT without server-issued signing context after connecting', async () => {
    const deps = createDeps({
      txData: { ...baseTxData, signingContext: undefined } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(
      result.current.signWithDevice({
        id: 'dev-no-context',
        type: 'Trezor Safe 3',
      } as any)
    ).resolves.toBe(false);

    expect(mocks.hardwareWallet.connect).toHaveBeenCalledWith('trezor', undefined);
    expect(deps.setError).toHaveBeenCalledWith(
      'This transaction has no server-issued hardware signing context; recreate it before signing'
    );
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.disconnect).toHaveBeenCalled();
  });

  it('binds a Jade Plus signing reconnect to the wallet network and stored model', async () => {
    const deps = createDeps({
      wallet: {
        id: 'wallet-1',
        type: 'single_sig',
        network: 'signet',
      } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(result.current.signWithDevice({
      id: 'jade-plus-1',
      type: 'Blockstream Jade Plus',
      model: { name: 'Blockstream Jade Plus' },
    } as any)).resolves.toBe(true);

    expect(mocks.hardwareWallet.connect).toHaveBeenCalledWith('jade', {
      chainEnvironment: 'signet',
      expectedModel: 'Jade Plus',
    });
  });

  it('binds a base Jade signing reconnect without promoting its stored model', async () => {
    const deps = createDeps({
      wallet: { id: 'wallet-1', type: 'single_sig', network: 'mainnet' } as any,
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(result.current.signWithDevice({
      id: 'jade-1',
      type: 'Blockstream Jade',
      model: { name: 'Blockstream Jade' },
    } as any)).resolves.toBe(true);

    expect(mocks.hardwareWallet.connect).toHaveBeenCalledWith('jade', {
      chainEnvironment: 'mainnet',
      expectedModel: 'Jade',
    });
  });

  it('fails closed before reconnecting Jade when the wallet network is absent', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(result.current.signWithDevice({
      id: 'jade-unknown-network',
      type: 'Blockstream Jade',
      model: { name: 'Blockstream Jade' },
    } as any)).resolves.toBe(false);

    expect(mocks.hardwareWallet.connect).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith(expect.stringMatching(/explicit wallet network/i));
  });

  it('signWithDevice persists a successful signature to a draft', async () => {
    const deps = createDeps({ draftId: 'draft-success' });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(
      result.current.signWithDevice({
        id: 'dev-success',
        type: 'Trezor Safe 3',
      } as any)
    ).resolves.toBe(true);

    expect(mocks.updateDraft).toHaveBeenCalledWith(
      'wallet-1',
      'draft-success',
      {
      signedPsbtBase64: 'signed-psbt',
      signedDeviceId: 'dev-success',
      },
      expect.any(AbortSignal)
    );
    expect(mocks.logger.info).toHaveBeenCalledWith('Signature persisted to draft', {
      draftId: 'draft-success',
      deviceId: 'dev-success',
    });
  });

  it('signWithDevice reports missing signing result when device returns neither psbt nor rawTx', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValueOnce({});
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'dev-2',
        type: 'Trezor Safe 3',
      } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith(
      'Hardware signing proof did not produce an applicable signed PSBT or transaction'
    );
    expect(mocks.hardwareWallet.disconnect).toHaveBeenCalled();
  });

  it('signWithDevice refuses signing without current transaction ownership', async () => {
    const deps = createDeps({ beginSigning: () => null });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(
      result.current.signWithDevice({
        id: 'dev-ownership',
        type: 'Trezor Safe 3',
      } as any)
    ).resolves.toBe(false);

    expect(deps.setError).toHaveBeenCalledWith(
      'Transaction changed; review it again before signing'
    );
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
  });

  it('does not send a PSBT to the device when ownership is lost during connection', async () => {
    let resolveConnect!: () => void;
    let current = true;
    mocks.hardwareWallet.connect.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveConnect = resolve;
      })
    );
    const controller = new AbortController();
    const deps = createDeps({
      beginSigning: () => ({
        signal: controller.signal,
        isCurrent: () => current,
      }),
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    const signing = result.current.signWithDevice({
      id: 'dev-stale',
      type: 'Trezor Safe 3',
    } as any);
    current = false;
    controller.abort();
    resolveConnect();

    await expect(signing).resolves.toBe(false);
    expect(mocks.hardwareWallet.signPSBT).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.disconnect).not.toHaveBeenCalled();
  });

  it('signWithDevice ignores a missing result after ownership is lost', async () => {
    let current = true;
    mocks.hardwareWallet.signPSBT.mockImplementationOnce(async () => {
      current = false;
      return {};
    });
    const controller = new AbortController();
    const deps = createDeps({
      beginSigning: () => ({
        signal: controller.signal,
        isCurrent: () => current,
      }),
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(
      result.current.signWithDevice({
        id: 'dev-stale',
        type: 'Trezor Safe 3',
      } as any)
    ).resolves.toBe(false);

    expect(deps.setError).toHaveBeenCalledOnce();
    expect(deps.setError).toHaveBeenCalledWith(null);
    expect(mocks.hardwareWallet.disconnect).not.toHaveBeenCalled();
  });

  it('does not apply a valid signature after transaction ownership is lost', async () => {
    let current = true;
    mocks.hardwareWallet.signPSBT.mockImplementationOnce(async () => {
      current = false;
      return { psbt: 'stale-signed-psbt' };
    });
    const controller = new AbortController();
    const deps = createDeps({
      beginSigning: () => ({
        signal: controller.signal,
        isCurrent: () => current,
      }),
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(
      result.current.signWithDevice({
        id: 'dev-stale',
        type: 'Trezor Safe 3',
      } as any)
    ).resolves.toBe(false);

    expect(deps.setUnsignedPsbt).not.toHaveBeenCalled();
    expect(deps.setSignedRawTx).not.toHaveBeenCalled();
    expect(deps.setSignedDevices).not.toHaveBeenCalled();
    expect(mocks.updateDraft).not.toHaveBeenCalled();
    expect(mocks.hardwareWallet.disconnect).not.toHaveBeenCalled();
  });

  it('signWithDevice surfaces Error message when signing throws Error', async () => {
    mocks.hardwareWallet.signPSBT.mockRejectedValueOnce(new Error('device signing failed'));
    const deps = createDeps();
    const { result } = renderHook(() => useUsbSigning(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'dev-3',
        type: 'Trezor Safe 3',
      } as any);
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
      ok = await result.current.signWithDevice({
        id: 'dev-4',
        type: 'Trezor Safe 3',
      } as any);
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('Failed to sign with device');
  });

  it('signWithDevice ignores failures after ownership is lost', async () => {
    let current = true;
    mocks.hardwareWallet.signPSBT.mockImplementationOnce(async () => {
      current = false;
      throw new Error('stale failure');
    });
    const controller = new AbortController();
    const deps = createDeps({
      beginSigning: () => ({
        signal: controller.signal,
        isCurrent: () => current,
      }),
    });
    const { result } = renderHook(() => useUsbSigning(deps));

    await expect(
      result.current.signWithDevice({
        id: 'dev-stale',
        type: 'Trezor Safe 3',
      } as any)
    ).resolves.toBe(false);

    expect(deps.setError).toHaveBeenCalledOnce();
    expect(deps.setError).toHaveBeenCalledWith(null);
    expect(mocks.hardwareWallet.disconnect).not.toHaveBeenCalled();
  });
});
