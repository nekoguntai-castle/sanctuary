import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  playEventSound: vi.fn(),
  format: vi.fn((sats: number) => `${sats} sats`),
  broadcastTransaction: vi.fn(),
  deleteDraft: vi.fn(),
  refetchQueries: vi.fn(),
  invalidateQueries: vi.fn(),
  fromBase64: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    showSuccess: mocks.showSuccess,
    showWarning: mocks.showWarning,
  }),
}));

vi.mock('../../src/hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: mocks.playEventSound,
  }),
}));

vi.mock('../../src/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: mocks.format,
  }),
  usePriceFreeFormatter: () => ({
    format: mocks.format,
    unit: 'sats',
  }),
}));

vi.mock('../../src/api/transactions', () => ({
  broadcastTransaction: mocks.broadcastTransaction,
}));

vi.mock('../../src/api/drafts', () => ({
  deleteDraft: mocks.deleteDraft,
}));

vi.mock('../../src/providers/QueryProvider', () => ({
  queryClient: {
    refetchQueries: mocks.refetchQueries,
    invalidateQueries: mocks.invalidateQueries,
  },
}));

vi.mock('bitcoinjs-lib', () => ({
  Psbt: {
    fromBase64: mocks.fromBase64,
  },
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

import { useBroadcast } from '../../src/hooks/send/useBroadcast';

const baseTxData = {
  psbtBase64: 'signed-psbt',
  fee: 123,
  totalInput: 10123,
  totalOutput: 10000,
  changeAmount: 0,
  effectiveAmount: 10000,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
  outputs: [{ address: 'bc1qrecipient', amount: 10000 }],
} as any;

function createDeps(overrides: Partial<Parameters<typeof useBroadcast>[0]> = {}) {
  return {
    walletId: 'wallet-1',
    wallet: { id: 'wallet-1', type: 'single_sig', name: 'Primary Wallet' } as any,
    state: {
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      draftId: null,
    } as any,
    txData: baseTxData,
    unsignedPsbt: 'signed-psbt',
    signedRawTx: null,
    setIsBroadcasting: vi.fn(),
    setError: vi.fn(),
    ...overrides,
  };
}

describe('useBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.broadcastTransaction.mockResolvedValue({
      txid: 'f'.repeat(64),
      broadcasted: true,
      persistenceStatus: 'complete',
    });
    mocks.deleteDraft.mockResolvedValue(undefined);
    mocks.refetchQueries.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockResolvedValue(undefined);
  });

  it('returns false when no transaction data is available', async () => {
    const deps = createDeps({ txData: null });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('No transaction to broadcast');
    expect(deps.setIsBroadcasting).not.toHaveBeenCalled();
  });

  it('returns false when neither PSBT nor raw tx is available', async () => {
    const deps = createDeps({
      unsignedPsbt: null,
      signedRawTx: null,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('No signed transaction available');
    expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
  });

  it('uses stored raw tx for single-sig and computes amount from outputs fallback', async () => {
    const deps = createDeps({
      unsignedPsbt: null,
      signedRawTx: 'deadbeef',
      txData: {
        ...baseTxData,
        effectiveAmount: undefined,
        outputs: [
          { address: 'bc1qone', amount: 2000 },
          { address: 'bc1qtwo', amount: 3000 },
        ],
      } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(true);
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', {
      rawTxHex: 'deadbeef',
      recipient: 'bc1qrecipient',
      amount: 5000,
      fee: 123,
      utxos: baseTxData.utxos,
    });
    expect(mocks.showSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Amount: 5000 sats'),
      'Transaction Broadcast'
    );
  });

  it('prefers raw transaction hex over PSBT when both signed sources are available for single-sig', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction('passed-psbt', 'passed-rawtx');
    });

    expect(ok).toBe(true);
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', expect.objectContaining({
      rawTxHex: 'passed-rawtx',
    }));
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith(
      'wallet-1',
      expect.not.objectContaining({ signedPsbtBase64: expect.any(String) })
    );
  });

  it('falls back to PSBT when a single-sig raw transaction source is empty', async () => {
    const deps = createDeps({ signedRawTx: '' });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(true);
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', expect.objectContaining({
      signedPsbtBase64: 'signed-psbt',
    }));
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith(
      'wallet-1',
      expect.not.objectContaining({ rawTxHex: expect.any(String) })
    );
  });

  it('skips raw tx for multisig, logs signature details, and formats success for multiple outputs', async () => {
    mocks.fromBase64.mockReturnValueOnce({
      data: {
        inputs: [
          {
            partialSig: [
              {
                pubkey: Buffer.from('11'.repeat(33), 'hex'),
                signature: Buffer.from('aa'.repeat(70), 'hex'),
              },
            ],
          },
        ],
      },
    });

    const deps = createDeps({
      wallet: { id: 'wallet-1', type: 'multi_sig', name: 'Multisig Wallet' } as any,
      signedRawTx: 'rawtx-from-device',
      state: {
        outputs: [
          { address: 'bc1qone', amount: '5000', sendMax: false },
          { address: 'bc1qtwo', amount: '5000', sendMax: false },
        ],
        draftId: null,
      } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction(undefined, 'passed-rawtx');
    });

    expect(ok).toBe(true);
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', {
      signedPsbtBase64: 'signed-psbt',
      recipient: 'bc1qone',
      amount: 10000,
      fee: 123,
      utxos: baseTxData.utxos,
    });
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'BROADCAST PSBT SIGNATURES',
      expect.objectContaining({
        inputIndex: 0,
        signatureCount: 1,
      })
    );
    expect(mocks.showSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Amount: 2 outputs'),
      'Transaction Broadcast'
    );
  });

  it('continues broadcasting when multisig debug parse fails', async () => {
    mocks.fromBase64.mockImplementationOnce(() => {
      throw new Error('parse failed');
    });
    const deps = createDeps({
      wallet: { id: 'wallet-1', type: 'multi_sig', name: 'Multisig Wallet' } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(true);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to parse PSBT for debug',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('broadcasts multisig transactions when debug PSBT inputs have no partial signatures', async () => {
    mocks.fromBase64.mockReturnValueOnce({
      data: {
        inputs: [{}],
      },
    });
    const deps = createDeps({
      wallet: { id: 'wallet-1', type: 'multi_sig', name: 'Multisig Wallet' } as any,
      txData: {
        ...baseTxData,
        effectiveAmount: undefined,
        outputs: [{ address: 'bc1qrecipient', amount: 10_000 }],
      } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(true);
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', {
      signedPsbtBase64: 'signed-psbt',
      recipient: 'bc1qrecipient',
      amount: 10_000,
      fee: 123,
      utxos: baseTxData.utxos,
    });
    expect(
      mocks.logger.info.mock.calls.some(([message]) => message === 'BROADCAST PSBT SIGNATURES')
    ).toBe(false);
  });

  it.each([
    { effectiveAmount: -1 },
    { effectiveAmount: 1.5 },
    { effectiveAmount: Number.MAX_SAFE_INTEGER + 1 },
    { effectiveAmount: undefined, outputs: undefined },
    { effectiveAmount: undefined, outputs: [{ address: 'bc1qrecipient', amount: 0 }] },
    {
      effectiveAmount: undefined,
      outputs: [
        { address: 'bc1qone', amount: Number.MAX_SAFE_INTEGER },
        { address: 'bc1qtwo', amount: 1 },
      ],
    },
  ])('refuses malformed transaction amount metadata before the broadcast API %#', async (amounts) => {
    const deps = createDeps({ txData: { ...baseTxData, ...amounts } as any });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(false);
    expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith(expect.stringContaining('Invalid'));
  });

  it('passes draftId to broadcast and leaves draft cleanup to the server', async () => {
    const deps = createDeps({
      state: {
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        draftId: 'draft-1',
      } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(true);
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', expect.objectContaining({
      draftId: 'draft-1',
    }));
    expect(mocks.deleteDraft).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
  });

  it('warns without a success sound when accepted persistence needs reconciliation', async () => {
    const txid = 'e'.repeat(64);
    mocks.broadcastTransaction.mockResolvedValueOnce({
      txid,
      broadcasted: true,
      persistenceStatus: 'pending_reconciliation',
      persistenceReason: 'post_acceptance_persistence_race',
    });
    const deps = createDeps();
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(true);
    expect(mocks.showWarning).toHaveBeenCalledWith(
      expect.stringContaining(txid),
      'Transaction Accepted'
    );
    expect(mocks.showSuccess).not.toHaveBeenCalled();
    expect(mocks.playEventSound).not.toHaveBeenCalled();
    expect(mocks.refetchQueries).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
  });

  it('returns false and surfaces Error message when broadcast API throws', async () => {
    mocks.broadcastTransaction.mockRejectedValueOnce(new Error('broadcast failed'));
    const deps = createDeps();
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('broadcast failed');
    expect(deps.setIsBroadcasting).toHaveBeenNthCalledWith(1, true);
    expect(deps.setIsBroadcasting).toHaveBeenLastCalledWith(false);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Transaction broadcast failed',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('returns false and uses fallback message for non-Error failures', async () => {
    mocks.broadcastTransaction.mockRejectedValueOnce('bad failure');
    const deps = createDeps();
    const { result } = renderHook(() => useBroadcast(deps));

    let ok = true;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });

    expect(ok).toBe(false);
    expect(deps.setError).toHaveBeenCalledWith('Failed to broadcast transaction');
  });
});
