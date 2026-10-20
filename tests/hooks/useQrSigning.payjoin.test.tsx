import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

vi.mock('../../src/api/drafts', () => ({
  updateDraft: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { useQrSigning } from '../../src/hooks/send/useQrSigning';

const P2WPKH_SCRIPT = Uint8Array.from([0x00, 0x14, ...new Array(20).fill(0x11)]);

const buildPsbt = (signed: boolean): string => {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: 'a'.repeat(64), index: 0, witnessUtxo: { script: P2WPKH_SCRIPT, value: 10123n } });
  psbt.addOutput({ script: P2WPKH_SCRIPT, value: 10000n });
  if (signed) {
    psbt.updateInput(0, {
      partialSig: [{ pubkey: Uint8Array.from([0x02, ...new Array(32).fill(0x22)]), signature: Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x01]) }],
    });
  }
  return psbt.toBase64();
};

function createDeps(overrides: Partial<Parameters<typeof useQrSigning>[0]> = {}): Parameters<typeof useQrSigning>[0] {
  const controller = new AbortController();
  return {
    walletId: 'wallet-1',
    wallet: { id: 'wallet-1', type: 'single_sig', name: 'Primary Wallet' } as never,
    draftId: null,
    txData: null,
    unsignedPsbt: buildPsbt(false),
    setError: vi.fn(),
    setUnsignedPsbt: vi.fn(),
    setSignedDevices: vi.fn(),
    beginSigning: () => ({ signal: controller.signal, isCurrent: () => true }),
    setIsSigning: vi.fn(),
    ...overrides,
  };
}

describe('useQrSigning payjoin origin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a file origin after an uploaded signed PSBT is accepted', async () => {
    const onSignedArtifactAccepted = vi.fn();
    const deps = createDeps({ onSignedArtifactAccepted });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File([buildPsbt(true)], 'signed.psbt', { type: 'text/plain' });

    await act(async () => {
      await result.current.uploadSignedPsbt(file);
    });

    expect(deps.setUnsignedPsbt).toHaveBeenCalledTimes(1);
    expect(onSignedArtifactAccepted).toHaveBeenCalledWith('file');
  });

  it('reports a qr origin after a scanned signed PSBT is accepted', async () => {
    const onSignedArtifactAccepted = vi.fn();
    const deps = createDeps({ onSignedArtifactAccepted });
    const { result } = renderHook(() => useQrSigning(deps));

    await act(async () => {
      await result.current.processQrSignedPsbt(buildPsbt(true), 'device-1');
    });

    expect(onSignedArtifactAccepted).toHaveBeenCalledWith('qr');
  });

  it('does not report an origin for a rejected artifact', async () => {
    const onSignedArtifactAccepted = vi.fn();
    const { result } = renderHook(() => useQrSigning(createDeps({
      onSignedArtifactAccepted,
      wallet: { id: 'wallet-1', type: 'multi_sig', name: 'Vault' } as never,
    })));

    await act(async () => {
      await expect(result.current.processQrSignedPsbt('not-a-psbt', 'device-1')).rejects.toThrow();
    });

    expect(onSignedArtifactAccepted).not.toHaveBeenCalled();
  });

  it('does not report an origin when the upload lost its lease', async () => {
    const onSignedArtifactAccepted = vi.fn();
    const controller = new AbortController();
    let current = true;
    const deps = createDeps({
      onSignedArtifactAccepted,
      beginSigning: () => ({ signal: controller.signal, isCurrent: () => current }),
      setUnsignedPsbt: vi.fn(() => { current = false; }),
    });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File([buildPsbt(true)], 'signed.psbt', { type: 'text/plain' });

    await act(async () => {
      await result.current.uploadSignedPsbt(file);
    });

    expect(onSignedArtifactAccepted).not.toHaveBeenCalled();
  });

  it('does not report a qr origin when the scan lost its lease', async () => {
    const onSignedArtifactAccepted = vi.fn();
    const controller = new AbortController();
    let current = true;
    const deps = createDeps({
      onSignedArtifactAccepted,
      beginSigning: () => ({ signal: controller.signal, isCurrent: () => current }),
      setUnsignedPsbt: vi.fn(() => { current = false; }),
    });
    const { result } = renderHook(() => useQrSigning(deps));

    await act(async () => {
      await result.current.processQrSignedPsbt(buildPsbt(true), 'device-1');
    });

    expect(onSignedArtifactAccepted).not.toHaveBeenCalled();
  });

  it.each(['file', 'qr'] as const)('refuses a %s artifact the payjoin round rejects, keeping signing state', async (origin) => {
    const onSignedArtifactAccepted = vi.fn();
    const checkSignedArtifact = vi.fn(() => 'not the proposal');
    const deps = createDeps({ onSignedArtifactAccepted, checkSignedArtifact });
    const { result } = renderHook(() => useQrSigning(deps));
    const signed = buildPsbt(true);

    await act(async () => {
      const pending = origin === 'file'
        ? result.current.uploadSignedPsbt(new File([signed], 'signed.psbt', { type: 'text/plain' }))
        : result.current.processQrSignedPsbt(signed, 'device-1');
      await expect(pending).rejects.toThrow('not the proposal');
    });

    expect(checkSignedArtifact).toHaveBeenCalledWith(signed);
    expect(deps.setError).toHaveBeenCalledWith('not the proposal');
    expect(deps.setUnsignedPsbt).not.toHaveBeenCalled();
    expect(deps.setSignedDevices).not.toHaveBeenCalled();
    expect(onSignedArtifactAccepted).not.toHaveBeenCalled();
  });

  it('accepts an artifact the payjoin round allows', async () => {
    const checkSignedArtifact = vi.fn(() => null);
    const deps = createDeps({ checkSignedArtifact });
    const { result } = renderHook(() => useQrSigning(deps));

    await act(async () => {
      await result.current.processQrSignedPsbt(buildPsbt(true), 'device-1');
    });

    expect(deps.setUnsignedPsbt).toHaveBeenCalledTimes(1);
  });
});
