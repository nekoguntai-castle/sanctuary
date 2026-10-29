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
import { ApiError } from '../../src/api/client';
import { walletActivityKeys, walletKeys } from '../../src/hooks/queries/useWallets';

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

function createDeps(overrides: Partial<Parameters<typeof useBroadcast>[0]> = {}): Parameters<typeof useBroadcast>[0] {
  const controller = new AbortController();
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
    setApprovalAction: vi.fn(),
    beginBroadcast: () => ({ signal: controller.signal, isCurrent: () => true }),
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

  it('still reports success and refreshes caches after ownership is lost, but never navigates, and still clears isBroadcasting', async () => {
    // Non-regression for send-broadcast-lease-drop-silent-success: a signing click mid-broadcast
    // (simulated here by flipping `isCurrent` to false and aborting the signal, as a real
    // `beginSigning()` call against a shared slot used to do — or an unmount, via
    // `useSendOperationOwner.ts`'s abort-on-unmount) must not silently drop a broadcast the
    // server already accepted. The notification and query-client handles are app-scoped, not
    // component-scoped, so the toast and `refetchBroadcastCaches()` must still run; only
    // `navigate()` (and component-local state) stay gated on `lease.isCurrent()`. The `finally`
    // reset must also run unconditionally, or `navigationLocked` in SendTransactionWizard.tsx
    // never clears.
    let resolveBroadcast!: (value: { txid: string; broadcasted: boolean; persistenceStatus: string }) => void;
    mocks.broadcastTransaction.mockReturnValueOnce(new Promise(resolve => { resolveBroadcast = resolve; }));
    let current = true;
    const controller = new AbortController();
    const deps = createDeps({
      beginBroadcast: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useBroadcast(deps));
    let request!: Promise<boolean>;
    act(() => { request = result.current.broadcastTransaction(); });
    current = false;
    controller.abort();
    await act(async () => {
      resolveBroadcast({ txid: 'f'.repeat(64), broadcasted: true, persistenceStatus: 'complete' });
      expect(await request).toBe(false);
    });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.showSuccess).toHaveBeenCalledOnce();
    expect(mocks.refetchQueries).toHaveBeenCalledTimes(2);
    expect(deps.setIsBroadcasting).toHaveBeenCalledTimes(2);
    expect(deps.setIsBroadcasting).toHaveBeenNthCalledWith(1, true);
    expect(deps.setIsBroadcasting).toHaveBeenLastCalledWith(false);
  });

  it('reports the reconciliation warning and refreshes caches after ownership is lost, without navigating', async () => {
    // Same contract as above, exercised on the pending_reconciliation branch: the reconciliation
    // toast is not a "component-local" concern, so a lost lease must not silence it either.
    let resolveBroadcast!: (value: { txid: string; broadcasted: boolean; persistenceStatus: string }) => void;
    mocks.broadcastTransaction.mockReturnValueOnce(new Promise(resolve => { resolveBroadcast = resolve; }));
    let current = true;
    const controller = new AbortController();
    const deps = createDeps({
      beginBroadcast: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useBroadcast(deps));
    let request!: Promise<boolean>;
    act(() => { request = result.current.broadcastTransaction(); });
    current = false;
    controller.abort();
    await act(async () => {
      resolveBroadcast({ txid: 'f'.repeat(64), broadcasted: true, persistenceStatus: 'pending_reconciliation' });
      expect(await request).toBe(false);
    });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.showSuccess).not.toHaveBeenCalled();
    expect(mocks.showWarning).toHaveBeenCalledOnce();
    expect(mocks.refetchQueries).toHaveBeenCalledTimes(2);
    expect(deps.setIsBroadcasting).toHaveBeenLastCalledWith(false);
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

  it('refuses broadcast when the reviewed transaction is no longer owned', async () => {
    const deps = createDeps({ beginBroadcast: () => null });
    const { result } = renderHook(() => useBroadcast(deps));

    await expect(result.current.broadcastTransaction()).resolves.toBe(false);

    expect(deps.setError).toHaveBeenCalledWith(
      'Transaction changed; review it again before broadcasting'
    );
    expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
  });

  it('does not navigate when ownership is lost during cache refresh', async () => {
    let current = true;
    mocks.refetchQueries.mockImplementation(async () => { current = false; });
    const controller = new AbortController();
    const deps = createDeps({
      beginBroadcast: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useBroadcast(deps));

    await expect(result.current.broadcastTransaction()).resolves.toBe(false);

    expect(mocks.showSuccess).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(deps.setIsBroadcasting).toHaveBeenCalledTimes(2);
    expect(deps.setIsBroadcasting).toHaveBeenLastCalledWith(false);
  });

  it('ignores a broadcast rejection after ownership is lost', async () => {
    let current = true;
    mocks.broadcastTransaction.mockImplementationOnce(async () => {
      current = false;
      throw new Error('stale failure');
    });
    const controller = new AbortController();
    const deps = createDeps({
      beginBroadcast: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useBroadcast(deps));

    await expect(result.current.broadcastTransaction()).resolves.toBe(false);

    expect(deps.setError).toHaveBeenCalledOnce();
    expect(deps.setError).toHaveBeenCalledWith(null);
    expect(mocks.logger.error).not.toHaveBeenCalled();
    expect(deps.setIsBroadcasting).toHaveBeenCalledTimes(2);
    expect(deps.setIsBroadcasting).toHaveBeenLastCalledWith(false);
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

  it('reports the server-bound recipient and net spend when a batch pays a wallet address first', async () => {
    const deps = createDeps({
      unsignedPsbt: null,
      signedRawTx: 'deadbeef',
      state: {
        outputs: [
          { address: 'bc1qown', amount: '20000', sendMax: false },
          { address: 'bc1qexternal', amount: '50000', sendMax: false },
        ],
        draftId: null,
      } as any,
      txData: {
        ...baseTxData,
        effectiveAmount: 50000,
        recipient: 'bc1qexternal',
        outputs: [
          { address: 'bc1qown', amount: 20000 },
          { address: 'bc1qexternal', amount: 50000 },
        ],
      } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    await act(async () => {
      await result.current.broadcastTransaction();
    });

    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', expect.objectContaining({
      recipient: 'bc1qexternal',
      amount: 50000,
    }));
  });

  it('refreshes only live canonical caches after broadcast', async () => {
    const { result } = renderHook(() => useBroadcast(createDeps()));

    await act(async () => {
      await result.current.broadcastTransaction();
    });

    expect(mocks.refetchQueries).toHaveBeenCalledTimes(2);
    expect(mocks.refetchQueries).toHaveBeenCalledWith({
      queryKey: walletActivityKeys.pendingTransactions.all,
    });
    expect(mocks.refetchQueries).toHaveBeenCalledWith({ queryKey: walletKeys.all });
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: walletActivityKeys.recentTransactions.all,
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: walletActivityKeys.balanceHistory.all,
    });
    expect(mocks.refetchQueries).not.toHaveBeenCalledWith({
      queryKey: ['wallet', 'wallet-1'],
    });
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['transactions', 'wallet-1'],
    });
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

  it('reports a typed all-uppercase bech32 recipient in canonical lowercase', async () => {
    const deps = createDeps({
      state: {
        outputs: [{ address: 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', amount: '10000', sendMax: false }],
        draftId: null,
      } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    await act(async () => {
      await result.current.broadcastTransaction();
    });

    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', expect.objectContaining({
      recipient: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    }));
  });

  it('includes replacesTxid in the broadcast payload when the RBF flow set it', async () => {
    const replacesTxid = 'a'.repeat(64);
    const deps = createDeps({
      state: {
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        draftId: 'draft-1',
        replacesTxid,
      } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    await act(async () => {
      await result.current.broadcastTransaction();
    });

    expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', expect.objectContaining({
      replacesTxid,
    }));
  });

  it('omits replacesTxid from the broadcast payload when it is null', async () => {
    const deps = createDeps({
      state: {
        outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
        draftId: null,
        replacesTxid: null,
      } as any,
    });
    const { result } = renderHook(() => useBroadcast(deps));

    await act(async () => {
      await result.current.broadcastTransaction();
    });

    const [, sentPayload] = mocks.broadcastTransaction.mock.calls[0];
    expect(sentPayload).not.toHaveProperty('replacesTxid');
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

  describe('approval-required refusals', () => {
    const forbidden = (details: Record<string, unknown>) =>
      new ApiError('Approval required', 403, { details });

    const broadcastFailing = async (error: ApiError, draftId: string | null) => {
      mocks.broadcastTransaction.mockRejectedValueOnce(error);
      const deps = createDeps({
        state: {
          outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
          draftId,
        } as any,
      });
      const { result } = renderHook(() => useBroadcast(deps));
      await act(async () => {
        await result.current.broadcastTransaction();
      });
      return deps;
    };

    it('offers Submit for approval when approval is required and there is no draft', async () => {
      const deps = await broadcastFailing(forbidden({ reason: 'approval_required' }), null);

      expect(deps.setError).toHaveBeenLastCalledWith(expect.stringMatching(/approval/i));
      expect(deps.setApprovalAction).toHaveBeenLastCalledWith('submit');
    });

    it('asks to recreate when approval is required on a resumed draft', async () => {
      const deps = await broadcastFailing(forbidden({ reason: 'approval_required' }), 'draft-1');

      expect(deps.setError).toHaveBeenLastCalledWith(expect.stringMatching(/delete.*create/i));
      expect(deps.setApprovalAction).toHaveBeenLastCalledWith('recreate');
    });

    it('prefers the server-resolved draft id over the local state', async () => {
      const deps = await broadcastFailing(
        forbidden({ reason: 'approval_required', draftId: 'server-draft' }),
        null,
      );

      expect(deps.setApprovalAction).toHaveBeenLastCalledWith('recreate');
    });

    it('asks to recreate after an approval rejection', async () => {
      const deps = await broadcastFailing(forbidden({ reason: 'approval_rejected', draftId: 'draft-1' }), 'draft-1');

      expect(deps.setApprovalAction).toHaveBeenLastCalledWith('recreate');
    });

    it('shows an awaiting-approval notice, with no action, for a pending draft', async () => {
      const deps = await broadcastFailing(
        forbidden({ reason: 'pending_approval', draftId: 'draft-1', approvalStatus: 'pending' }),
        'draft-1',
      );

      expect(deps.setError).toHaveBeenLastCalledWith(expect.stringMatching(/awaiting approval/i));
      expect(deps.setApprovalAction).toHaveBeenLastCalledWith(null);
    });

    it.each(['vetoed', 'expired', undefined])(
      'asks to recreate a draft whose approval status is %s',
      async (approvalStatus) => {
        const deps = await broadcastFailing(
          forbidden({ reason: 'pending_approval', draftId: 'draft-1', approvalStatus }),
          'draft-1',
        );

        expect(deps.setApprovalAction).toHaveBeenLastCalledWith('recreate');
      },
    );

    it('keeps the server message and no action for other forbidden reasons', async () => {
      const deps = await broadcastFailing(forbidden({ reason: 'policy_blocked' }), null);

      expect(deps.setError).toHaveBeenLastCalledWith('Approval required');
      expect(deps.setApprovalAction).toHaveBeenLastCalledWith(null);
    });

    it('ignores approval details on non-403 errors and on 403s without details', async () => {
      const serverError = await broadcastFailing(
        new ApiError('Server exploded', 500, { details: { reason: 'approval_required' } }),
        null,
      );
      expect(serverError.setError).toHaveBeenLastCalledWith('Server exploded');
      expect(serverError.setApprovalAction).toHaveBeenLastCalledWith(null);

      const bare = await broadcastFailing(new ApiError('Forbidden', 403), null);
      expect(bare.setError).toHaveBeenLastCalledWith('Forbidden');
      expect(bare.setApprovalAction).toHaveBeenLastCalledWith(null);
    });

    it('clears a stale approval action when a new broadcast starts', async () => {
      const deps = createDeps();
      const { result } = renderHook(() => useBroadcast(deps));
      await act(async () => {
        await result.current.broadcastTransaction();
      });

      expect(deps.setApprovalAction).toHaveBeenCalledWith(null);
    });
  });

  describe('payjoin overrides', () => {
    it('broadcasts the override transaction instead of the rendered one', async () => {
      const deps = createDeps();
      const { result } = renderHook(() => useBroadcast(deps));
      const original = { ...baseTxData, intentId: 'intent-original', intentDigest: 'd'.repeat(64), fee: 77 };

      await act(async () => {
        await result.current.broadcastTransaction('original-psbt', undefined, { transaction: original });
      });

      expect(mocks.broadcastTransaction).toHaveBeenCalledWith('wallet-1', expect.objectContaining({
        signedPsbtBase64: 'original-psbt',
        intentId: 'intent-original',
        intentDigest: 'd'.repeat(64),
        fee: 77,
      }));
    });

    it('broadcasts an override transaction when nothing is rendered yet', async () => {
      const deps = createDeps({ txData: null });
      const { result } = renderHook(() => useBroadcast(deps));

      await act(async () => {
        expect(await result.current.broadcastTransaction('original-psbt', undefined, { transaction: baseTxData }))
          .toBe(true);
      });
    });

    it.each([
      ['a 400 ApiError', new ApiError('Signing intent is stale', 400, { details: { reason: 'stale_intent' } }),
        { status: 400, reason: 'stale_intent' }],
      ['a 403 ApiError', new ApiError('Forbidden', 403, { details: { reason: 'approval_required' } }),
        { status: 403, reason: 'approval_required' }],
      ['an ApiError without details', new ApiError('Unavailable', 503), { status: 503, reason: undefined }],
      ['an ApiError with a non-string reason', new ApiError('Odd', 400, { details: { reason: 7 } }),
        { status: 400, reason: undefined }],
      ['a non-ApiError', new Error('network down'), { status: undefined, reason: undefined }],
    ])('reports %s to onFailure', async (_label, error, expected) => {
      mocks.broadcastTransaction.mockRejectedValueOnce(error);
      const onFailure = vi.fn();
      const deps = createDeps();
      const { result } = renderHook(() => useBroadcast(deps));

      await act(async () => {
        expect(await result.current.broadcastTransaction(undefined, undefined, { onFailure })).toBe(false);
      });

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(expected);
    });

    it('does not report a rejection after ownership is lost', async () => {
      let current = true;
      mocks.broadcastTransaction.mockImplementationOnce(async () => {
        current = false;
        throw new ApiError('stale', 400, { details: { reason: 'stale_intent' } });
      });
      const controller = new AbortController();
      const onFailure = vi.fn();
      const deps = createDeps({
        beginBroadcast: () => ({ signal: controller.signal, isCurrent: () => current }),
      });
      const { result } = renderHook(() => useBroadcast(deps));

      await expect(result.current.broadcastTransaction(undefined, undefined, { onFailure })).resolves.toBe(false);
      expect(onFailure).not.toHaveBeenCalled();
    });

    it('does not report a success whose lease went stale', async () => {
      let current = true;
      mocks.refetchQueries.mockImplementation(async () => { current = false; });
      const controller = new AbortController();
      const onFailure = vi.fn();
      const deps = createDeps({
        beginBroadcast: () => ({ signal: controller.signal, isCurrent: () => current }),
      });
      const { result } = renderHook(() => useBroadcast(deps));

      await expect(result.current.broadcastTransaction(undefined, undefined, { onFailure })).resolves.toBe(false);
      expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(onFailure).not.toHaveBeenCalled();
    });
  });
});
