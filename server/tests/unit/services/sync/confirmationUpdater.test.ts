import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFindMany,
  mockQueryRaw,
  mockExecuteRaw,
  mockTransaction,
  mockUpdateTransactionConfirmations,
  mockUpdateTransactionConfirmationsAtHeight,
  mockPopulateMissingTransactionFields,
  mockGetAddressHistory,
  mockGetAddressHistoryBatch,
  mockGetBlockHeight,
  mockEmitTransactionConfirmed,
  mockAcquireLock,
  mockExtendLock,
  mockGetSyncLockTtlMs,
  mockReleaseLock,
  mockMaxSyncDurationMs,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn<(args: unknown) => Promise<Array<{ walletId: string }>>>(),
  mockQueryRaw: vi.fn<(args: unknown) => Promise<Array<{ walletId: string }>>>(),
  mockExecuteRaw: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdateTransactionConfirmations: vi.fn(),
  mockUpdateTransactionConfirmationsAtHeight: vi.fn(),
  mockPopulateMissingTransactionFields: vi.fn(),
  mockGetAddressHistory: vi.fn(),
  mockGetAddressHistoryBatch: vi.fn(),
  mockGetBlockHeight: vi.fn(),
  mockEmitTransactionConfirmed: vi.fn(),
  mockAcquireLock: vi.fn(),
  mockExtendLock: vi.fn(),
  mockGetSyncLockTtlMs: vi.fn(),
  mockReleaseLock: vi.fn(),
  mockMaxSyncDurationMs: vi.fn(),
}));

vi.mock('../../../../src/config', () => ({
  getConfig: () => ({ sync: { maxSyncDurationMs: mockMaxSyncDurationMs() } }),
}));

vi.mock('../../../../src/infrastructure', () => ({
  acquireLock: mockAcquireLock,
  extendLock: mockExtendLock,
  releaseLock: mockReleaseLock,
}));

vi.mock('../../../../src/jobs/syncJobContract', () => ({
  getSyncLockKey: ({ walletId }: { walletId: string }) => `sync:wallet:${walletId}`,
  getSyncLockTtlMs: mockGetSyncLockTtlMs,
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: {
    $transaction: mockTransaction,
    transaction: {
      findMany: mockFindMany,
      groupBy: vi.fn(),
    },
  },
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  updateTransactionConfirmations: mockUpdateTransactionConfirmations,
  populateMissingTransactionFields: mockPopulateMissingTransactionFields,
  getAddressHistory: mockGetAddressHistory,
  getAddressHistoryBatch: mockGetAddressHistoryBatch,
  getBlockHeight: mockGetBlockHeight,
}));

vi.mock('../../../../src/services/bitcoin/sync/confirmations/updateConfirmations', () => ({
  updateTransactionConfirmationsAtHeight: mockUpdateTransactionConfirmationsAtHeight,
}));

vi.mock('../../../../src/services/eventService', () => ({
  eventService: {
    emitTransactionConfirmed: mockEmitTransactionConfirmed,
  },
}));

import {
  ConfirmationLockUnavailableError,
  ConfirmationRefreshError,
  refreshAllPendingConfirmations,
  refreshPendingConfirmations,
  refreshWalletConfirmations,
} from '../../../../src/services/sync/confirmationUpdater';
import {
  refreshConfirmationRetryWalletsAtHeight,
  refreshPendingConfirmationsAtHeight,
} from '../../../../src/services/sync/headerConfirmationUpdater';
import type { ConfirmationUpdate } from '../../../../src/services/bitcoin/blockchain';

describe('confirmationUpdater', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);
    mockExecuteRaw.mockResolvedValue(1);
    mockTransaction.mockImplementation(async (callback) => callback({
      $executeRaw: mockExecuteRaw,
      $queryRaw: mockQueryRaw,
    }));
    mockAcquireLock.mockResolvedValue({ key: 'sync:wallet:test', token: 'token' });
    mockExtendLock.mockImplementation(async lock => lock);
    mockGetSyncLockTtlMs.mockReturnValue(120_000);
    mockReleaseLock.mockResolvedValue('deleted');
    mockMaxSyncDurationMs.mockReturnValue(10_000);
    mockPopulateMissingTransactionFields.mockResolvedValue({
      updated: 0,
      confirmationUpdates: [],
    });
    mockUpdateTransactionConfirmations.mockResolvedValue([]);
    mockUpdateTransactionConfirmationsAtHeight.mockResolvedValue([]);
  });

  it('populates missing fields before updating confirmations', async () => {
    mockPopulateMissingTransactionFields.mockResolvedValue({
      updated: 2,
      confirmationUpdates: [
        { txid: 'from-populate', oldConfirmations: 0, newConfirmations: 1 },
      ],
    });
    mockUpdateTransactionConfirmations.mockResolvedValue([
      { txid: 'from-update', oldConfirmations: 1, newConfirmations: 2 },
    ]);

    const result = await refreshWalletConfirmations('wallet-1');

    expect(mockPopulateMissingTransactionFields).toHaveBeenCalledWith(
      'wallet-1',
      expect.any(AbortSignal),
      expect.any(Function),
      undefined,
      true,
    );
    expect(mockUpdateTransactionConfirmations).toHaveBeenCalledWith(
      'wallet-1',
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(mockPopulateMissingTransactionFields.mock.invocationCallOrder[0])
      .toBeLessThan(mockUpdateTransactionConfirmations.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({
      walletId: 'wallet-1',
      fieldUpdates: 2,
      confirmationUpdateCount: 2,
      milestoneCount: 1,
    });
    expect(result.confirmationUpdates).toEqual([
      { txid: 'from-populate', oldConfirmations: 0, newConfirmations: 1 },
      { txid: 'from-update', oldConfirmations: 1, newConfirmations: 2 },
    ]);
  });

  it('publishes each actual confirmation change exactly once through eventService', async () => {
    const change = { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 };
    mockPopulateMissingTransactionFields.mockResolvedValue({
      updated: 1,
      confirmationUpdates: [change],
    });
    mockUpdateTransactionConfirmations.mockResolvedValue([change]);

    const result = await refreshWalletConfirmations('wallet-1');

    expect(result.confirmationUpdates).toEqual([change]);
    expect(mockEmitTransactionConfirmed).toHaveBeenCalledOnce();
    expect(mockEmitTransactionConfirmed).toHaveBeenCalledWith({
      walletId: 'wallet-1',
      txid: 'tx-1',
      confirmations: 1,
      blockHeight: 0,
      previousConfirmations: 0,
    });
  });

  it('contains publication failures after persistence and continues publishing', async () => {
    mockUpdateTransactionConfirmations.mockResolvedValue([
      { txid: 'tx-fail', oldConfirmations: 0, newConfirmations: 1 },
      { txid: 'tx-ok', oldConfirmations: 1, newConfirmations: 2 },
    ]);
    const publicationError = new Error('publisher unavailable');
    mockEmitTransactionConfirmed
      .mockImplementationOnce(() => { throw publicationError; })
      .mockImplementationOnce(() => undefined);

    const result = await refreshWalletConfirmations('wallet-1');

    expect(mockUpdateTransactionConfirmations).toHaveBeenCalledOnce();
    expect(mockEmitTransactionConfirmed).toHaveBeenCalledTimes(2);
    expect(result.publicationFailures).toEqual([
      { walletId: 'wallet-1', txid: 'tx-fail', error: publicationError },
    ]);
    expect(result.confirmationUpdateCount).toBe(2);
  });

  it('queries, stably deduplicates, and sorts pending wallets', async () => {
    mockFindMany.mockResolvedValue([
      { walletId: 'wallet-z' },
      { walletId: 'wallet-a' },
      { walletId: 'wallet-z' },
      { walletId: 'wallet-m' },
    ]);

    const result = await refreshPendingConfirmations('testnet4');

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        confirmations: { lt: 6 },
        wallet: { network: { in: ['testnet4'] } },
      },
      select: { walletId: true },
      distinct: ['walletId'],
    });
    expect(mockPopulateMissingTransactionFields.mock.calls.map(([walletId]) => walletId)).toEqual([
      'wallet-a',
      'wallet-m',
      'wallet-z',
    ]);
    expect(result.walletIds).toEqual(['wallet-a', 'wallet-m', 'wallet-z']);
    expect(mockAcquireLock).toHaveBeenCalledTimes(3);
    for (const [, options] of mockAcquireLock.mock.calls) {
      expect(options).toMatchObject({ waitTimeMs: 0 });
    }
  });

  it('refreshes only the emitting network at an already-reconciled height', async () => {
    mockQueryRaw.mockResolvedValue([
      { walletId: 'wallet-z' },
      { walletId: 'wallet-a' },
    ]);
    mockUpdateTransactionConfirmationsAtHeight.mockResolvedValue([
      { txid: 'persisted-tx', oldConfirmations: 4, newConfirmations: 2 },
    ]);

    const result = await refreshPendingConfirmationsAtHeight('signet', 102);

    expect(mockQueryRaw).toHaveBeenCalledOnce();
    expect(mockExecuteRaw).toHaveBeenCalledOnce();
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
    expect(mockUpdateTransactionConfirmationsAtHeight.mock.calls).toEqual([
      ['wallet-a', 102, expect.any(AbortSignal), expect.any(Function)],
      ['wallet-z', 102, expect.any(AbortSignal), expect.any(Function)],
    ]);
    expect(result.walletIds).toEqual(['wallet-z', 'wallet-a']);
    expect(result).toMatchObject({
      nextCursor: 'wallet-a',
      enumerationComplete: true,
    });
    expect(mockAcquireLock).toHaveBeenCalledTimes(2);
    expect(mockAcquireLock).toHaveBeenNthCalledWith(1, 'sync:wallet:wallet-a', {
      ttlMs: 120_000,
      waitTimeMs: 0,
      retryIntervalMs: 100,
    });
    expect(mockReleaseLock).toHaveBeenCalledTimes(2);
    expect(mockPopulateMissingTransactionFields).not.toHaveBeenCalled();
    expect(mockUpdateTransactionConfirmations).not.toHaveBeenCalled();
    expect(mockGetAddressHistory).not.toHaveBeenCalled();
    expect(mockGetAddressHistoryBatch).not.toHaveBeenCalled();
    expect(mockGetBlockHeight).not.toHaveBeenCalled();
  });

  it('selects persisted testnet aliases for a canonical testnet3 height', async () => {
    await expect(refreshPendingConfirmationsAtHeight('testnet3', 102)).resolves.toMatchObject({
      walletIds: [],
      failures: [],
    });

    expect(mockQueryRaw).toHaveBeenCalledOnce();
  });

  it('bounds authoritative confirmation selection and returns a stable resume cursor', async () => {
    const firstPage = Array.from({ length: 101 }, (_, index) => ({
      walletId: `wallet-${String(index).padStart(3, '0')}`,
    }));
    mockQueryRaw
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([{ walletId: 'wallet-100' }]);

    const first = await refreshPendingConfirmationsAtHeight('mainnet', 100);
    const second = await refreshPendingConfirmationsAtHeight(
      'mainnet',
      100,
      () => true,
      first.nextCursor,
    );

    expect(first).toMatchObject({
      nextCursor: 'wallet-099',
      enumerationComplete: false,
    });
    expect(first.walletIds).toHaveLength(100);
    expect(second).toMatchObject({
      nextCursor: 'wallet-100',
      enumerationComplete: true,
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });

  it('records a failed first wallet but still processes every later candidate', async () => {
    mockQueryRaw.mockResolvedValue([
      { walletId: 'wallet-a' },
      { walletId: 'wallet-b' },
      { walletId: 'wallet-c' },
    ]);
    const firstError = new Error('first wallet failed');
    mockUpdateTransactionConfirmationsAtHeight
      .mockRejectedValueOnce(firstError);

    const result = await refreshPendingConfirmationsAtHeight('mainnet', 900_000);

    expect(result.failures).toEqual([
      { walletId: 'wallet-a', error: firstError },
    ]);
    expect(result.wallets.map(({ walletId }) => walletId)).toEqual([
      'wallet-b',
      'wallet-c',
    ]);
    expect(result.nextCursor).toBe('wallet-c');
    expect(result.enumerationComplete).toBe(true);
    expect(mockUpdateTransactionConfirmationsAtHeight).toHaveBeenCalledTimes(3);
  });

  it('refreshes every durable retry wallet at the explicit height without history lookups', async () => {
    const result = await refreshConfirmationRetryWalletsAtHeight(
      ['wallet-z', 'wallet-a'],
      777,
    );

    expect(mockUpdateTransactionConfirmationsAtHeight.mock.calls).toEqual([
      ['wallet-a', 777, expect.any(AbortSignal), expect.any(Function)],
      ['wallet-z', 777, expect.any(AbortSignal), expect.any(Function)],
    ]);
    expect(result.walletIds).toEqual(['wallet-a', 'wallet-z']);
    expect(result.failures).toEqual([]);
    expect(mockAcquireLock).toHaveBeenCalledTimes(2);
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockPopulateMissingTransactionFields).not.toHaveBeenCalled();
    expect(mockUpdateTransactionConfirmations).not.toHaveBeenCalled();
    expect(mockGetAddressHistory).not.toHaveBeenCalled();
    expect(mockGetAddressHistoryBatch).not.toHaveBeenCalled();
    expect(mockGetBlockHeight).not.toHaveBeenCalled();
  });

  it('rejects an invalid authoritative height before refreshing retry wallets', async () => {
    await expect(refreshConfirmationRetryWalletsAtHeight(['wallet-a'], -1)).rejects.toThrow(
      'Authoritative block height must be a non-negative safe integer',
    );

    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', []],
    ['oversize', Array.from({ length: 101 }, (_, index) => `wallet-${index}`)],
  ])('rejects an %s confirmation retry page', async (_description, walletIds) => {
    await expect(refreshConfirmationRetryWalletsAtHeight(walletIds, 100)).rejects.toThrow(
      'retry page size is invalid',
    );

    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it('rejects a retry page that starts without reconciliation ownership', async () => {
    await expect(refreshConfirmationRetryWalletsAtHeight(
      ['wallet-a'],
      100,
      () => false,
    )).rejects.toThrow('ownership is not active');

    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it('aborts and cleans up a retry page when its deadline expires', async () => {
    vi.useFakeTimers();
    mockMaxSyncDurationMs.mockReturnValue(30_000);
    mockUpdateTransactionConfirmationsAtHeight.mockImplementationOnce((
      _walletId: string,
      _height: number,
      signal: AbortSignal,
    ) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));

    try {
      const refresh = refreshConfirmationRetryWalletsAtHeight(['wallet-a'], 100);
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(refresh).resolves.toMatchObject({
        failures: [{
          walletId: 'wallet-a',
          error: expect.objectContaining({
            message: 'Network header confirmation retry page timed out',
          }),
        }],
      });
      expect(mockReleaseLock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records every unattempted wallet as retryable when a page deadline expires', async () => {
    vi.useFakeTimers();
    mockMaxSyncDurationMs.mockReturnValue(30_000);
    mockQueryRaw.mockResolvedValue([
      { walletId: 'wallet-a' },
      { walletId: 'wallet-b' },
    ]);
    mockUpdateTransactionConfirmationsAtHeight.mockImplementationOnce((
      _walletId: string,
      _height: number,
      signal: AbortSignal,
    ) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));

    try {
      const refresh = refreshPendingConfirmationsAtHeight('mainnet', 100);
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(refresh).resolves.toMatchObject({
        nextCursor: 'wallet-b',
        enumerationComplete: true,
        failures: [
          { walletId: 'wallet-a', error: expect.objectContaining({
            message: 'Network header confirmation page timed out',
          }) },
          { walletId: 'wallet-b', error: expect.objectContaining({
            message: 'Network header confirmation page timed out',
          }) },
        ],
      });
      expect(mockUpdateTransactionConfirmationsAtHeight).toHaveBeenCalledOnce();
      expect(mockReleaseLock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid authoritative height before selecting wallets', async () => {
    await expect(refreshPendingConfirmationsAtHeight('mainnet', -1)).rejects.toThrow(
      'Authoritative block height must be a non-negative safe integer',
    );

    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it.each([0, 101, 1.5])('rejects invalid confirmation page size %s', async pageSize => {
    await expect(refreshPendingConfirmationsAtHeight(
      'mainnet',
      100,
      () => true,
      null,
      pageSize,
    )).rejects.toThrow('page size is invalid');

    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('rejects an authoritative-height sweep that starts without ownership', async () => {
    await expect(refreshPendingConfirmationsAtHeight('mainnet', 100, () => false))
      .rejects.toThrow('ownership is not active');

    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('keeps an authoritative-height sweep active while ownership remains valid', async () => {
    vi.useFakeTimers();
    let finishSelection!: (rows: Array<{ walletId: string }>) => void;
    mockQueryRaw.mockReturnValueOnce(new Promise(resolve => {
      finishSelection = resolve;
    }));

    try {
      const refresh = refreshPendingConfirmationsAtHeight('mainnet', 100, () => true);
      await vi.advanceTimersByTimeAsync(25);
      finishSelection([]);

      await expect(refresh).resolves.toMatchObject({ walletIds: [], failures: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an authoritative-height sweep when reconciliation ownership is lost', async () => {
    vi.useFakeTimers();
    mockQueryRaw.mockReturnValueOnce(new Promise(() => undefined));
    let active = true;

    try {
      const refresh = refreshPendingConfirmationsAtHeight('mainnet', 100, () => active);
      const rejected = expect(refresh).rejects.toThrow('ownership was lost');
      active = false;
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(mockAcquireLock).not.toHaveBeenCalled();
      expect(mockUpdateTransactionConfirmationsAtHeight).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an authoritative-height page when its deadline expires', async () => {
    vi.useFakeTimers();
    mockQueryRaw.mockReturnValueOnce(new Promise(() => undefined));

    try {
      const refresh = refreshPendingConfirmationsAtHeight('mainnet', 100);
      const rejected = expect(refresh).rejects.toThrow('confirmation page timed out');
      await vi.advanceTimersByTimeAsync(20_000);

      await rejected;
      expect(mockAcquireLock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates an authoritative-height selection failure', async () => {
    const queryError = new Error('confirmation selection unavailable');
    mockQueryRaw.mockRejectedValueOnce(queryError);

    await expect(refreshPendingConfirmationsAtHeight('mainnet', 100)).rejects.toBe(queryError);
    expect(mockAcquireLock).not.toHaveBeenCalled();
  });

  it('retains the wallet lock until an uncooperative authoritative-height write settles', async () => {
    vi.useFakeTimers();
    mockQueryRaw.mockResolvedValue([{ walletId: 'wallet-a' }]);
    let settleWrite!: (updates: ConfirmationUpdate[]) => void;
    mockUpdateTransactionConfirmationsAtHeight.mockImplementationOnce(
      () => new Promise(resolve => { settleWrite = resolve; }),
    );
    let active = true;

    try {
      const refresh = refreshPendingConfirmationsAtHeight('mainnet', 100, () => active);
      await vi.waitFor(() => {
        expect(mockUpdateTransactionConfirmationsAtHeight).toHaveBeenCalledOnce();
      });

      active = false;
      await vi.advanceTimersByTimeAsync(25);
      expect(mockReleaseLock).not.toHaveBeenCalled();

      settleWrite([]);
      await expect(refresh).resolves.toMatchObject({
        failures: [{
          walletId: 'wallet-a',
          error: expect.objectContaining({
            message: 'Network header reconciliation ownership was lost',
          }),
        }],
      });
      expect(mockReleaseLock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains a lost wallet lease until an in-flight authoritative-height write settles', async () => {
    vi.useFakeTimers();
    mockGetSyncLockTtlMs.mockReturnValue(300);
    mockQueryRaw.mockResolvedValue([{ walletId: 'wallet-a' }]);
    mockExtendLock.mockResolvedValueOnce(null);
    let settleWrite!: (updates: ConfirmationUpdate[]) => void;
    mockUpdateTransactionConfirmationsAtHeight.mockImplementationOnce(
      () => new Promise(resolve => { settleWrite = resolve; }),
    );

    try {
      const refresh = refreshPendingConfirmationsAtHeight('mainnet', 100);
      await vi.waitFor(() => {
        expect(mockUpdateTransactionConfirmationsAtHeight).toHaveBeenCalledOnce();
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(mockExtendLock).toHaveBeenCalledOnce();
      expect(mockReleaseLock).not.toHaveBeenCalled();

      settleWrite([]);
      await expect(refresh).resolves.toMatchObject({
        failures: [{
          walletId: 'wallet-a',
          error: expect.objectContaining({
            message: 'confirmation refresh lost its wallet sync lock',
          }),
        }],
      });
      expect(mockReleaseLock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes explicit-height updates only after their persistence callback', async () => {
    mockQueryRaw.mockResolvedValue([{ walletId: 'wallet-1' }]);
    const change = { txid: 'persisted-tx', oldConfirmations: 0, newConfirmations: 1 };
    mockUpdateTransactionConfirmationsAtHeight.mockImplementationOnce(async (
      _walletId: string,
      _height: number,
      _signal: AbortSignal,
      onCommit: (result: { updated: number; confirmationUpdates: typeof change[] }) => void,
    ) => {
      expect(mockEmitTransactionConfirmed).not.toHaveBeenCalled();
      onCommit({ updated: 0, confirmationUpdates: [change] });
      expect(mockEmitTransactionConfirmed).toHaveBeenCalledOnce();
      return [change];
    });

    const result = await refreshPendingConfirmationsAtHeight('testnet4', 10);

    expect(result.confirmationUpdateCount).toBe(1);
    expect(mockEmitTransactionConfirmed).toHaveBeenCalledOnce();
  });

  it('skips a contended sweep wallet immediately and continues with later wallets', async () => {
    mockFindMany.mockResolvedValue([{ walletId: 'wallet-a' }, { walletId: 'wallet-b' }]);
    mockAcquireLock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ key: 'sync:wallet:wallet-b', token: 'wallet-b' });

    const result = await refreshPendingConfirmations('mainnet');

    expect(result.failures).toEqual([{
      walletId: 'wallet-a',
      error: expect.any(ConfirmationLockUnavailableError),
    }]);
    expect(result.wallets).toEqual([
      expect.objectContaining({ walletId: 'wallet-b' }),
    ]);
    expect(mockPopulateMissingTransactionFields).toHaveBeenCalledOnce();
    expect(mockPopulateMissingTransactionFields).toHaveBeenCalledWith(
      'wallet-b',
      expect.any(AbortSignal),
      expect.any(Function),
      undefined,
      true,
    );
  });

  it('returns typed failures and continues with later wallets', async () => {
    mockFindMany.mockResolvedValue([
      { walletId: 'wallet-a' },
      { walletId: 'wallet-b' },
    ]);
    const walletError = new Error('wallet failed');
    mockPopulateMissingTransactionFields
      .mockRejectedValueOnce(walletError)
      .mockResolvedValueOnce({ updated: 0, confirmationUpdates: [] });

    const result = await refreshPendingConfirmations('mainnet');

    expect(mockPopulateMissingTransactionFields).toHaveBeenCalledTimes(2);
    expect(result.failures).toEqual([
      { walletId: 'wallet-a', error: walletError },
    ]);
    expect(result.wallets.map(({ walletId }) => walletId)).toEqual(['wallet-b']);
  });

  it('aggregates persisted changes, milestones, and publication failures', async () => {
    mockFindMany.mockResolvedValue([{ walletId: 'wallet-1' }]);
    mockPopulateMissingTransactionFields.mockResolvedValue({
      updated: 2,
      confirmationUpdates: [
        { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 },
      ],
    });
    mockUpdateTransactionConfirmations.mockResolvedValue([
      { txid: 'tx-2', oldConfirmations: 1, newConfirmations: 2 },
    ]);
    const publicationError = new Error('publisher unavailable');
    mockEmitTransactionConfirmed.mockImplementationOnce(() => { throw publicationError; });

    const result = await refreshPendingConfirmations('mainnet');

    expect(result).toMatchObject({
      fieldUpdates: 2,
      confirmationUpdateCount: 2,
      milestoneCount: 1,
      failures: [],
    });
    expect(result.publicationFailures).toEqual([
      { walletId: 'wallet-1', txid: 'tx-1', error: publicationError },
    ]);
  });

  it('publishes and returns committed population work when the later update phase fails', async () => {
    const committed = { txid: 'tx-partial', oldConfirmations: 0, newConfirmations: 1 };
    mockPopulateMissingTransactionFields.mockImplementationOnce(async (
      _walletId: string,
      _signal: AbortSignal,
      onCommit: (result: { updated: number; confirmationUpdates: typeof committed[] }) => void,
    ) => {
      onCommit({ updated: 1, confirmationUpdates: [committed] });
      return { updated: 1, confirmationUpdates: [committed] };
    });
    const updateError = new Error('confirmation update failed');
    mockUpdateTransactionConfirmations.mockRejectedValueOnce(updateError);

    const error = await refreshWalletConfirmations('wallet-1').catch(value => value);

    expect(error).toBeInstanceOf(ConfirmationRefreshError);
    expect(error).toMatchObject({
      cause: updateError,
      partialResult: {
        walletId: 'wallet-1',
        fieldUpdates: 1,
        confirmationUpdates: [committed],
        confirmationUpdateCount: 1,
        milestoneCount: 1,
      },
    });
    expect(mockEmitTransactionConfirmed).toHaveBeenCalledOnce();
  });

  it('returns and aggregates update-phase batches committed before a later batch fails', async () => {
    mockFindMany.mockResolvedValue([{ walletId: 'wallet-1' }]);
    const committed = { txid: 'tx-update-partial', oldConfirmations: 0, newConfirmations: 1 };
    const updateError = new Error('later confirmation batch failed');
    mockUpdateTransactionConfirmations.mockImplementationOnce(async (
      _walletId: string,
      _signal: AbortSignal,
      onCommit: (result: { updated: number; confirmationUpdates: typeof committed[] }) => void,
    ) => {
      onCommit({ updated: 0, confirmationUpdates: [committed] });
      throw updateError;
    });

    const result = await refreshPendingConfirmations('mainnet');

    expect(result.wallets).toEqual([
      expect.objectContaining({
        walletId: 'wallet-1',
        confirmationUpdates: [committed],
        confirmationUpdateCount: 1,
      }),
    ]);
    expect(result.failures).toEqual([{ walletId: 'wallet-1', error: updateError }]);
    expect(mockEmitTransactionConfirmed).toHaveBeenCalledOnce();
  });

  it('renews the wallet lock while a refresh remains active', async () => {
    vi.useFakeTimers();
    try {
      mockGetSyncLockTtlMs.mockReturnValue(300);
      const extendedLock = {
        key: 'sync:wallet:wallet-1',
        token: 'extended',
        expiresAt: 600,
        isLocal: false,
      };
      mockExtendLock.mockResolvedValueOnce(extendedLock);
      let resolveUpdate!: (updates: ConfirmationUpdate[]) => void;
      mockUpdateTransactionConfirmations.mockImplementationOnce(
        () => new Promise(resolve => { resolveUpdate = resolve; }),
      );

      const refresh = refreshWalletConfirmations('wallet-1');
      await vi.advanceTimersByTimeAsync(100);
      expect(mockExtendLock).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'token' }),
        300,
      );
      resolveUpdate([]);
      await refresh;

      expect(mockReleaseLock).toHaveBeenCalledWith(extendedLock);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the refresh before lock expiry when renewal loses ownership', async () => {
    vi.useFakeTimers();
    try {
      mockGetSyncLockTtlMs.mockReturnValue(300);
      mockExtendLock.mockResolvedValueOnce(null);
      mockUpdateTransactionConfirmations.mockImplementationOnce((
        _walletId: string,
        signal: AbortSignal,
      ) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));

      const refresh = refreshWalletConfirmations('wallet-1');
      const rejection = refresh.catch(error => error);
      await vi.advanceTimersByTimeAsync(100);

      const error = await rejection;
      expect(error).toBeInstanceOf(ConfirmationRefreshError);
      expect(error.message).toContain('lost its wallet sync lock');
      expect(mockReleaseLock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the refresh when lock renewal fails', async () => {
    vi.useFakeTimers();
    try {
      mockGetSyncLockTtlMs.mockReturnValue(300);
      const renewalError = new Error('lock backend unavailable');
      mockExtendLock.mockRejectedValueOnce(renewalError);
      mockUpdateTransactionConfirmations.mockImplementationOnce((
        _walletId: string,
        signal: AbortSignal,
      ) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));

      const rejection = refreshWalletConfirmations('wallet-1').catch(error => error);
      await vi.advanceTimersByTimeAsync(100);

      const error = await rejection;
      expect(error).toBeInstanceOf(ConfirmationRefreshError);
      expect(error.cause).toBe(renewalError);
      expect(mockReleaseLock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the wallet lock when a refresh exceeds its duration budget', async () => {
    vi.useFakeTimers();
    try {
      mockMaxSyncDurationMs.mockReturnValue(1_000);
      mockUpdateTransactionConfirmations.mockImplementationOnce((
        _walletId: string,
        signal: AbortSignal,
      ) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));

      const rejection = refreshWalletConfirmations('wallet-1').catch(error => error);
      await vi.advanceTimersByTimeAsync(1_000);

      const error = await rejection;
      expect(error).toBeInstanceOf(ConfirmationRefreshError);
      expect(error.message).toContain('timed out after 1000ms');
      expect(mockReleaseLock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not apply a late lock extension after the refresh has stopped', async () => {
    vi.useFakeTimers();
    try {
      mockGetSyncLockTtlMs.mockReturnValue(300);
      let resolveExtension!: (lock: { key: string; token: string }) => void;
      mockExtendLock.mockImplementationOnce(
        () => new Promise(resolve => { resolveExtension = resolve; }),
      );
      let resolveUpdate!: (updates: ConfirmationUpdate[]) => void;
      mockUpdateTransactionConfirmations.mockImplementationOnce(
        () => new Promise(resolve => { resolveUpdate = resolve; }),
      );

      const refresh = refreshWalletConfirmations('wallet-1');
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      expect(mockExtendLock).toHaveBeenCalledOnce();

      resolveUpdate([]);
      await refresh;
      resolveExtension({ key: 'sync:wallet:wallet-1', token: 'late' });
      await Promise.resolve();

      expect(mockReleaseLock).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'token' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('contains a late lock-renewal rejection after the refresh has stopped', async () => {
    vi.useFakeTimers();
    try {
      mockGetSyncLockTtlMs.mockReturnValue(300);
      let rejectExtension!: (error: Error) => void;
      mockExtendLock.mockImplementationOnce(
        () => new Promise((_resolve, reject) => { rejectExtension = reject; }),
      );
      let resolveUpdate!: (updates: ConfirmationUpdate[]) => void;
      mockUpdateTransactionConfirmations.mockImplementationOnce(
        () => new Promise(resolve => { resolveUpdate = resolve; }),
      );

      const refresh = refreshWalletConfirmations('wallet-1');
      await vi.advanceTimersByTimeAsync(100);
      resolveUpdate([]);
      await refresh;

      rejectExtension(new Error('late renewal failure'));
      await Promise.resolve();

      expect(mockReleaseLock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes concurrent refreshes behind the shared wallet sync lock', async () => {
    let releaseSecond!: (lock: { key: string; token: string }) => void;
    const secondLock = new Promise<{ key: string; token: string }>((resolve) => {
      releaseSecond = resolve;
    });
    mockAcquireLock
      .mockResolvedValueOnce({ key: 'sync:wallet:wallet-1', token: 'first' })
      .mockReturnValueOnce(secondLock);
    mockReleaseLock.mockImplementationOnce(async () => {
      releaseSecond({ key: 'sync:wallet:wallet-1', token: 'second' });
      return 'deleted';
    });
    mockPopulateMissingTransactionFields.mockResolvedValue({
      updated: 0,
      confirmationUpdates: [],
    });
    mockUpdateTransactionConfirmations.mockReset();
    let resolveUpdate!: (updates: ConfirmationUpdate[]) => void;
    mockUpdateTransactionConfirmations
      .mockImplementationOnce(() => new Promise(resolve => { resolveUpdate = resolve; }))
      .mockResolvedValueOnce([]);

    const first = refreshWalletConfirmations('wallet-1');
    const second = refreshWalletConfirmations('wallet-1');
    await vi.waitFor(() => expect(mockUpdateTransactionConfirmations).toHaveBeenCalledTimes(1));
    resolveUpdate([{ txid: 'tx-once', oldConfirmations: 0, newConfirmations: 1 }]);
    await Promise.all([first, second]);

    expect(mockUpdateTransactionConfirmations).toHaveBeenCalledTimes(2);
    expect(mockEmitTransactionConfirmed).toHaveBeenCalledOnce();
    expect(mockAcquireLock).toHaveBeenNthCalledWith(1, 'sync:wallet:wallet-1', {
      ttlMs: 120_000,
      waitTimeMs: 30_000,
      retryIntervalMs: 100,
    });
  });

  it('fails with an empty partial result when the wallet lock remains held', async () => {
    mockAcquireLock.mockResolvedValueOnce(null);

    const error = await refreshWalletConfirmations('wallet-1').catch(value => value);

    expect(error).toBeInstanceOf(ConfirmationRefreshError);
    expect(error.partialResult).toMatchObject({
      walletId: 'wallet-1',
      fieldUpdates: 0,
      confirmationUpdateCount: 0,
    });
    expect(mockPopulateMissingTransactionFields).not.toHaveBeenCalled();
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });

  it('retains an unexpected lock authority failure in the batch failure result', async () => {
    const authorityError = new Error('lock authority unavailable');
    mockFindMany.mockResolvedValueOnce([{ walletId: 'wallet-1' }]);
    mockAcquireLock.mockRejectedValueOnce(authorityError);

    const result = await refreshAllPendingConfirmations();

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { confirmations: { lt: 6 } },
      select: { walletId: true },
      distinct: ['walletId'],
    });
    expect(result.failures).toEqual([{ walletId: 'wallet-1', error: authorityError }]);
    expect(result.wallets).toEqual([]);
  });

  it('propagates the pending-wallet query failure to the caller policy', async () => {
    const queryError = new Error('database unavailable');
    mockFindMany.mockRejectedValue(queryError);

    await expect(refreshAllPendingConfirmations()).rejects.toBe(queryError);
  });
});
