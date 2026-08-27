import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks } from '../../../mocks/electrum';

const { mockExecuteSyncPipeline } = vi.hoisted(() => ({
  mockExecuteSyncPipeline: vi.fn(),
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../src/services/bitcoin/sync', () => ({
  executeSyncPipeline: mockExecuteSyncPipeline,
  defaultSyncPhases: [],
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

import { syncWallet } from '../../../../src/services/bitcoin/blockchain';
import { getNodeClient } from '../../../../src/services/bitcoin/nodeClient';
import { walletLog } from '../../../../src/websocket/notifications';
import { createSyncPhaseProgress } from '../../../../src/services/bitcoin/sync/phaseProgress';

describe('Blockchain syncWallet recursion', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    mockExecuteSyncPipeline.mockReset();
  });

  it('recursively syncs when new generated addresses contain transaction history', async () => {
    const walletId = 'wallet-recursive';
    const scanAddress = 'tb1qk2n44m4g4d8f67mz5fdtg6v9pfh2j08rj9j3xg';
    const controller = new AbortController();
    const telemetry = {
      beginStage: vi.fn((_stage: string, _startedAt?: number) => true),
      finishStage: vi.fn((_stage: string, _outcome: string, _finishedAt?: number) => true),
      observeProgress: vi.fn(),
      recordCandidates: vi.fn(),
    };
    const phaseProgress = createSyncPhaseProgress(walletId, telemetry);

    mockExecuteSyncPipeline
      .mockResolvedValueOnce({
        addresses: 2,
        transactions: 1,
        utxos: 1,
        stats: { newAddressesGenerated: 1 },
      })
      .mockResolvedValueOnce({
        addresses: 1,
        transactions: 2,
        utxos: 3,
        stats: { newAddressesGenerated: 0 },
      });

    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
      new Map([[scanAddress, [{ tx_hash: 'a'.repeat(64), height: 100 }]]])
    );

    const result = await syncWallet(
      walletId,
      0,
      controller.signal,
      undefined,
      Number.POSITIVE_INFINITY,
      telemetry,
      phaseProgress,
    );

    expect(mockExecuteSyncPipeline).toHaveBeenCalledTimes(2);
    expect(mockElectrumClient.subscribeAddressBatch).not.toHaveBeenCalled();
    expect(telemetry.beginStage).toHaveBeenCalledWith('address_history', expect.any(Number));
    expect(telemetry.finishStage).toHaveBeenCalledWith(
      'address_history',
      'completed',
      expect.any(Number),
    );
    expect(mockExecuteSyncPipeline).toHaveBeenNthCalledWith(
      2,
      walletId,
      [],
      expect.objectContaining({
        attemptRuntime: expect.objectContaining({ phaseProgress }),
      }),
    );
    const ownershipRepair = mockPrismaClient.$executeRaw.mock.calls
      .map(([statement]) => statement as { strings: string[]; values: unknown[] })
      .find(statement => statement.strings.join('').includes(
        'INSERT INTO "transaction_ownership_repairs"'
      ));
    expect(ownershipRepair).toBeDefined();
    expect(ownershipRepair!.strings.join('')).toContain(
      'INSERT INTO "transaction_ownership_repairs"'
    );
    expect(ownershipRepair!.values).toEqual([walletId, 1, 'a'.repeat(64)]);
    expect(walletLog).toHaveBeenCalledWith(
      walletId,
      'info',
      'BLOCKCHAIN',
      expect.stringContaining('re-syncing')
    );
    expect(result).toEqual({
      addresses: 3,
      transactions: 3,
      utxos: 4,
    });
  });

  it('fails the sync when ownership repair targets cannot be persisted', async () => {
    const walletId = 'wallet-target-failure';
    const scanAddress = 'tb1qtargetfailure';
    mockExecuteSyncPipeline.mockResolvedValue({
      addresses: 1,
      transactions: 0,
      utxos: 0,
      stats: { newAddressesGenerated: 1 },
    });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-target-failure', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
      new Map([[scanAddress, [{ tx_hash: 'b'.repeat(64), height: 200 }]]])
    );
    mockPrismaClient.$executeRaw.mockRejectedValueOnce(new Error('target database unavailable'));

    await expect(syncWallet(walletId)).rejects.toThrow(
      'Failed to persist ownership repair targets'
    );
    expect(mockExecuteSyncPipeline).toHaveBeenCalledOnce();
  });

  it('records and closes a recursive address-history budget fallback', async () => {
    const walletId = 'wallet-recursive-budget';
    const scanAddress = 'tb1qrecursivebudget';
    const controller = new AbortController();
    const telemetry = {
      beginStage: vi.fn((_stage: string, _startedAt?: number) => true),
      finishStage: vi.fn((_stage: string, _outcome: string, _finishedAt?: number) => true),
      observeProgress: vi.fn(),
      recordCandidates: vi.fn(),
    };
    const phaseProgress = createSyncPhaseProgress(walletId, telemetry);
    mockExecuteSyncPipeline.mockResolvedValueOnce({
      addresses: 1,
      transactions: 0,
      utxos: 0,
      stats: { newAddressesGenerated: 1 },
    });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-budget', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockImplementationOnce(
      async (_addresses, options) => {
        options?.signal?.throwIfAborted();
        return new Map();
      },
    );

    await expect(syncWallet(
      walletId,
      0,
      controller.signal,
      undefined,
      Date.now() - 1,
      telemetry,
      phaseProgress,
    )).resolves.toEqual({ addresses: 1, transactions: 0, utxos: 0 });

    expect(telemetry.finishStage.mock.calls).toEqual(expect.arrayContaining([
      ['address_history', 'budget_expired', expect.any(Number)],
      ['address_history', 'completed', expect.any(Number)],
    ]));
    expect(telemetry.beginStage.mock.calls.filter(
      ([stage]) => stage === 'address_history',
    )).toHaveLength(2);
  });

  it('records a cancelled recursive address-history scan as aborted', async () => {
    const walletId = 'wallet-recursive-cancelled';
    const scanAddress = 'tb1qrecursivecancelled';
    const controller = new AbortController();
    const telemetry = {
      beginStage: vi.fn((_stage: string, _startedAt?: number) => true),
      finishStage: vi.fn((_stage: string, _outcome: string, _finishedAt?: number) => true),
      observeProgress: vi.fn(),
      recordCandidates: vi.fn(),
    };
    const phaseProgress = createSyncPhaseProgress(walletId, telemetry);
    mockExecuteSyncPipeline.mockResolvedValueOnce({
      addresses: 1,
      transactions: 0,
      utxos: 0,
      stats: { newAddressesGenerated: 1 },
    });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-cancelled', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockImplementationOnce(async () => {
      controller.abort(new Error('operator cancelled recursive scan'));
      throw controller.signal.reason;
    });

    await expect(syncWallet(
      walletId,
      0,
      controller.signal,
      undefined,
      Number.POSITIVE_INFINITY,
      telemetry,
      phaseProgress,
    )).rejects.toThrow('operator cancelled recursive scan');

    expect(telemetry.finishStage).toHaveBeenCalledWith(
      'address_history',
      'aborted',
      expect.any(Number),
    );
  });

  it('records an ordinary recursive address-history scan failure as failed', async () => {
    const walletId = 'wallet-recursive-failed';
    const controller = new AbortController();
    const telemetry = {
      beginStage: vi.fn((_stage: string, _startedAt?: number) => true),
      finishStage: vi.fn((_stage: string, _outcome: string, _finishedAt?: number) => true),
      observeProgress: vi.fn(),
      recordCandidates: vi.fn(),
    };
    const phaseProgress = createSyncPhaseProgress(walletId, telemetry);
    mockExecuteSyncPipeline.mockResolvedValueOnce({
      addresses: 1,
      transactions: 0,
      utxos: 0,
      stats: { newAddressesGenerated: 1 },
    });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-failed', address: 'tb1qrecursivefailed', used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockRejectedValueOnce(
      new Error('recursive address scan unavailable'),
    );

    await expect(syncWallet(
      walletId,
      0,
      controller.signal,
      undefined,
      Number.POSITIVE_INFINITY,
      telemetry,
      phaseProgress,
    )).resolves.toEqual({ addresses: 1, transactions: 0, utxos: 0 });

    expect(telemetry.finishStage).toHaveBeenCalledWith(
      'address_history',
      'failed',
      expect.any(Number),
    );
  });

  it('propagates the cancellation signal into a recursive gap-limit sync', async () => {
    const walletId = 'wallet-recursive-signal';
    const scanAddress = 'tb1qrecursivesignal';
    const controller = new AbortController();
    mockExecuteSyncPipeline
      .mockResolvedValueOnce({
        addresses: 1,
        transactions: 1,
        utxos: 1,
        stats: { newAddressesGenerated: 1 },
      })
      .mockResolvedValueOnce({
        addresses: 1,
        transactions: 0,
        utxos: 0,
        stats: { newAddressesGenerated: 0 },
      });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-signal', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
      new Map([[scanAddress, [{ tx_hash: 'c'.repeat(64), height: 300 }]]])
    );

    await syncWallet(walletId, 0, controller.signal);

    expect(mockExecuteSyncPipeline).toHaveBeenCalledTimes(2);
    expect(mockExecuteSyncPipeline).toHaveBeenNthCalledWith(
      1,
      walletId,
      [],
      {
        signal: controller.signal,
        attemptRuntime: { signal: controller.signal, deadlineAt: Number.POSITIVE_INFINITY },
      },
    );
    expect(mockExecuteSyncPipeline).toHaveBeenNthCalledWith(
      2,
      walletId,
      [],
      {
        signal: controller.signal,
        attemptRuntime: { signal: controller.signal, deadlineAt: Number.POSITIVE_INFINITY },
      },
    );
  });

  it('passes attempt telemetry through the immutable runtime', async () => {
    const controller = new AbortController();
    const telemetry = {
      beginStage: vi.fn(() => true),
      finishStage: vi.fn(() => true),
      observeProgress: vi.fn(),
      recordCandidates: vi.fn(),
    };
    mockExecuteSyncPipeline.mockResolvedValueOnce({
      addresses: 1,
      transactions: 2,
      utxos: 3,
      stats: { newAddressesGenerated: 0 },
    });

    await syncWallet(
      'wallet-telemetry',
      0,
      controller.signal,
      undefined,
      123_456,
      telemetry,
    );

    expect(mockExecuteSyncPipeline).toHaveBeenCalledWith(
      'wallet-telemetry',
      [],
      {
        signal: controller.signal,
        attemptRuntime: {
          signal: controller.signal,
          deadlineAt: 123_456,
          telemetry,
        },
      },
    );
  });

  it('passes the immutable mutation fence into the sync pipeline', async () => {
    const walletId = 'wallet-fenced';
    const mutationFence = {
      walletId,
      generation: 7,
      leaseToken: 'lease-token-7',
    };
    mockExecuteSyncPipeline.mockResolvedValueOnce({
      addresses: 1,
      transactions: 2,
      utxos: 3,
      stats: { newAddressesGenerated: 0 },
    });

    await expect(syncWallet(
      walletId,
      0,
      undefined,
      mutationFence,
    )).resolves.toEqual({ addresses: 1, transactions: 2, utxos: 3 });

    expect(mockExecuteSyncPipeline).toHaveBeenCalledWith(
      walletId,
      [],
      { mutationFence },
    );
  });

  it('continues with original result when scanning generated addresses fails', async () => {
    const walletId = 'wallet-scan-error';
    const scanAddress = 'tb1q4f6x6a9wruy6s8hwj5em8z2s9yc03tf0m3etf8';
    const baseResult = {
      addresses: 4,
      transactions: 5,
      utxos: 6,
      stats: { newAddressesGenerated: 1 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-2', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockRejectedValue(new Error('scan failed'));

    const result = await syncWallet(walletId);

    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
    expect(mockExecuteSyncPipeline).toHaveBeenCalledTimes(1);
  });

  it('scans generated addresses without mutating subscription ownership', async () => {
    const walletId = 'wallet-network-read-only';
    const scanAddress = 'tb1qv2m8n0h3l6j4z8u3n6n2s4m5k7y8p9q0r1t2u3';
    const baseResult = {
      addresses: 2,
      transactions: 0,
      utxos: 0,
      stats: { newAddressesGenerated: 1 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-fallback', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map([[scanAddress, []]]));

    const result = await syncWallet(walletId);

    expect(mockElectrumClient.subscribeAddressBatch).not.toHaveBeenCalled();
    expect(mockElectrumClient.subscribeAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
  });

  it('returns base result when generated-address scan is requested but wallet is missing', async () => {
    const walletId = 'wallet-missing';
    const baseResult = {
      addresses: 7,
      transactions: 8,
      utxos: 9,
      stats: { newAddressesGenerated: 2 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const result = await syncWallet(walletId);

    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
    expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    expect(mockElectrumClient.getAddressHistoryBatch).not.toHaveBeenCalled();
  });

  it('uses mainnet fallback and returns base result when no generated addresses are found', async () => {
    const walletId = 'wallet-mainnet-fallback';
    const baseResult = {
      addresses: 5,
      transactions: 1,
      utxos: 2,
      stats: { newAddressesGenerated: 1 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: '',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([]);

    const result = await syncWallet(walletId);

    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
    expect(vi.mocked(getNodeClient)).toHaveBeenCalledWith('mainnet');
    expect(mockElectrumClient.getAddressHistoryBatch).not.toHaveBeenCalled();
  });

  it('stops recursion at MAX_GAP_LIMIT_RECURSION depth', async () => {
    const walletId = 'wallet-deep-recursion';
    const scanAddress = 'tb1qdeeprecursion';

    // Every pipeline call generates new addresses with transactions,
    // simulating the infinite loop scenario
    mockExecuteSyncPipeline.mockImplementation(async () => ({
      addresses: 1,
      transactions: 1,
      utxos: 1,
      stats: { newAddressesGenerated: 1 },
    }));

    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-deep', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
      new Map([[scanAddress, [{ tx_hash: 'b'.repeat(64), height: 200 }]]])
    );

    const result = await syncWallet(walletId);

    // Should stop at depth 10: 1 initial + 10 recursive = 11 pipeline calls
    expect(mockExecuteSyncPipeline).toHaveBeenCalledTimes(11);

    // Results should be accumulated from all 11 calls
    expect(result).toEqual({
      addresses: 11,
      transactions: 11,
      utxos: 11,
    });
  });

  it('does not recurse when generated addresses have no transaction history', async () => {
    const walletId = 'wallet-no-new-history';
    const scanAddress = 'tb1q6j8r8w8r0pg6j7mt6v4n3v0q0q7xg84n2n8l8t';
    const baseResult = {
      addresses: 3,
      transactions: 4,
      utxos: 5,
      stats: { newAddressesGenerated: 1 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-empty-history', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map([[scanAddress, []]]));

    const result = await syncWallet(walletId);

    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
    expect(mockExecuteSyncPipeline).toHaveBeenCalledTimes(1);
    expect(walletLog).not.toHaveBeenCalled();
  });
});
