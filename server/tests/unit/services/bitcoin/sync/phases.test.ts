import { vi, Mock } from 'vitest';

vi.mock('../../../../../src/services/hardwareWalletCapabilities', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../src/services/hardwareWalletCapabilities')>(),
  assertWalletHardwareCapabilityById: vi.fn(),
}));
/**
 * Sync Phase Tests — Small Phases
 *
 * Unit tests for individual sync pipeline phases:
 * rbfCleanupPhase, fetchHistoriesPhase, checkExistingPhase,
 * fetchUtxosPhase, updateAddressesPhase, gapLimitPhase, fixConsolidationsPhase.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  resetElectrumMocks,
  createMockTransaction,
} from '../../../../mocks/electrum';
import { registerFetchUtxosPhaseTests } from './phases/fetchUtxos.contracts';

// Mock Prisma
vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../src/repositories/syncIntentRepository', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../src/repositories/syncIntentRepository')>(),
  requestIncrementalSyncWithClient: vi.fn(async () => ({
    status: 'merged' as const,
    state: {},
  })),
}));

// Mock node client
vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../../src/services/bitcoin/sync/evidenceAuthentication', () => ({
  authenticateHistoryResults: vi.fn(),
  fetchAuthenticatedTransactions: vi.fn(async (ctx, txids) => {
    for (const txid of txids) ctx.txDetailsCache.set(txid, { txid, hex: '00', vin: [], vout: [] });
    return new Set(txids);
  }),
}));

vi.mock('../../../../../src/services/bitcoin/rawTransactionEvidence', () => ({
  RawTransactionEvidenceError: class extends Error {},
  authenticateRawTransactionOutput: vi.fn(),
}));

// Mock notifications
vi.mock('../../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn().mockReturnValue({
    broadcastTransactionNotification: vi.fn(),
  }),
}));

// Mock notification service
vi.mock('../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: vi.fn().mockResolvedValue(undefined),
}));

// Mock config
vi.mock('../../../../../src/config', () => ({
  getConfig: () => ({
    sync: { transactionBatchSize: 100 },
  }),
}));

// Mock balance calculation
vi.mock('../../../../../src/services/bitcoin/utils/balanceCalculation', () => ({
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
  prepareMisclassifiedConsolidations: vi.fn(),
  persistMisclassifiedConsolidations: vi.fn(),
}));

// Mock address derivation
vi.mock('../../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveCanonicalAddress: vi.fn().mockImplementation((_descriptors, coordinate) => ({
    address: `tb1q_test_${coordinate.branch}_${coordinate.index}`,
    derivationPath: `m/84'/0'/0'/${coordinate.branch}/${coordinate.index}`,
    scriptPubKey: `0014${'00'.repeat(20)}`,
    branch: coordinate.branch,
    index: coordinate.index,
    signerOrigins: [],
  })),
  deriveAddressFromDescriptor: vi.fn().mockImplementation((descriptor, index, options) => {
    const change = options?.change ? 1 : 0;
    return {
      address: `tb1q_test_${change}_${index}`,
      derivationPath: `m/84'/0'/0'/${change}/${index}`,
      publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
    };
  }),
}));

// Mock block height utility
vi.mock('../../../../../src/services/bitcoin/utils/blockHeight', () => ({
  getBlockTimestamp: vi.fn().mockResolvedValue(new Date('2024-01-15T12:00:00Z')),
}));

import {
  createTestContext,
  rbfCleanupPhase,
  fetchHistoriesPhase,
  checkExistingPhase,
  updateAddressesPhase,
  gapLimitPhase,
  fixConsolidationsPhase,
  type SyncContext,
} from '../../../../../src/services/bitcoin/sync';
import {
  CLASSIFICATION_REPAIR_CANDIDATE_LIMIT,
  IO_REPAIR_CANDIDATE_LIMIT,
} from '../../../../../src/services/bitcoin/sync/phases/checkExisting';

// Import the mocked balance calculation to control it per test
import {
  persistMisclassifiedConsolidations,
  prepareMisclassifiedConsolidations,
  recalculateWalletBalances,
} from '../../../../../src/services/bitcoin/utils/balanceCalculation';

// Import block height mock
import { getBlockTimestamp } from '../../../../../src/services/bitcoin/utils/blockHeight';
import { getNotificationService, walletLog } from '../../../../../src/websocket/notifications';
import { notifyNewTransactions } from '../../../../../src/services/notifications/notificationService';
import { fetchAuthenticatedTransactions } from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import { ElectrumFrameTooLargeError } from '../../../../../src/services/bitcoin/electrum/protocol';

describe('Sync Phases', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    vi.mocked(fetchAuthenticatedTransactions).mockImplementation(async (ctx, txids) => {
      for (const txid of txids) {
        ctx.txDetailsCache.set(txid, { txid, hex: '00', vin: [], vout: [] });
      }
      return new Set(txids);
    });
  });

  describe('rbfCleanupPhase', () => {
    it('should mark pending transactions as replaced when confirmed tx shares input', async () => {
      const pendingTxid = 'pending_' + 'a'.repeat(56);
      const confirmedTxid = 'confirmed_' + 'b'.repeat(53);

      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        // Pending txs with active RBF status
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [{
            id: 'pending-tx-id',
            txid: pendingTxid,
            inputs: [{ txid: 'input_txid', vout: 0 }],
          }];
        }
        // Batch query: confirmed txs sharing inputs with pending txs
        if (args?.where?.confirmations?.gt === 0 && args?.where?.inputs?.some?.OR) {
          return [{
            txid: confirmedTxid,
            inputs: [{ txid: 'input_txid', vout: 0 }],
          }];
        }
        // Unlinked replaced txs
        if (args?.where?.rbfStatus === 'replaced' && args?.where?.replacedByTxid === null) {
          return [];
        }
        return [];
      });

      const updateCalls: any[] = [];
      mockPrismaClient.transaction.update.mockImplementation(async (args: any) => {
        updateCalls.push(args);
        return args;
      });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      await rbfCleanupPhase(ctx);

      // Verify the pending tx was marked as replaced
      const rbfUpdate = updateCalls.find(
        (call) => call.data?.rbfStatus === 'replaced' && call.data?.replacedByTxid === confirmedTxid
      );
      expect(rbfUpdate).toBeDefined();
    });

    it('should not mark pending transaction if no confirmed replacement found', async () => {
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [{
            id: 'pending-tx-id',
            txid: 'pending_txid',
            inputs: [{ txid: 'input_txid', vout: 0 }],
          }];
        }
        // No confirmed replacement found
        if (args?.where?.confirmations?.gt === 0 && args?.where?.inputs?.some?.OR) {
          return [];
        }
        return [];
      });

      const updateCalls: any[] = [];
      mockPrismaClient.transaction.update.mockImplementation(async (args: any) => {
        updateCalls.push(args);
        return args;
      });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      await rbfCleanupPhase(ctx);

      const rbfUpdate = updateCalls.find((call) => call.data?.rbfStatus === 'replaced');
      expect(rbfUpdate).toBeUndefined();
    });

    it('should link unlinked replaced transactions retroactively', async () => {
      const replacedTxid = 'replaced_' + 'a'.repeat(55);
      const replacementTxid = 'replacement_' + 'b'.repeat(52);

      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.where?.rbfStatus === 'replaced' && args?.where?.replacedByTxid === null) {
          return [{
            id: 'unlinked-tx-id',
            txid: replacedTxid,
            inputs: [{ txid: 'shared_input', vout: 0 }],
          }];
        }
        // Batch query: confirmed txs sharing inputs with unlinked txs
        if (args?.where?.confirmations?.gt === 0 && args?.where?.inputs?.some?.OR) {
          return [{
            txid: replacementTxid,
            inputs: [{ txid: 'shared_input', vout: 0 }],
          }];
        }
        return [];
      });

      const updateCalls: any[] = [];
      mockPrismaClient.transaction.update.mockImplementation(async (args: any) => {
        updateCalls.push(args);
        return args;
      });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      await rbfCleanupPhase(ctx);

      const linkUpdate = updateCalls.find(
        (call) => call.where?.id === 'unlinked-tx-id' && call.data?.replacedByTxid === replacementTxid
      );
      expect(linkUpdate).toBeDefined();
    });
  });

  describe('fetchHistoriesPhase', () => {
    it('records only unresolved fallback addresses when the local history budget expires', async () => {
      vi.useFakeTimers();
      try {
        const acceptedAddress = 'history-accepted';
        const failedAddress = 'history-failed';
        const budgetAddress = 'history-budget';
        const acceptedHistory = [{ tx_hash: 'a'.repeat(64), height: 800000 }];
        mockElectrumClient.getAddressHistoryBatch.mockRejectedValue(new Error('Batch failed'));
        mockElectrumClient.getAddressHistory.mockImplementation(
          async (address: string, options?: { signal?: AbortSignal }) => {
            if (address === acceptedAddress) return acceptedHistory;
            if (address === failedAddress) throw new Error('Individual failed');
            return new Promise((_, reject) => {
              options?.signal?.addEventListener(
                'abort',
                () => reject(options.signal?.reason),
                { once: true },
              );
            });
          },
        );
        const now = Date.now();
        const phaseProgress = {
          begin: vi.fn(() => true),
          finish: vi.fn(() => true),
          budgetExpired: vi.fn(() => true),
          activeStage: vi.fn(() => 'address_history' as const),
        };
        const ctx = createTestContext({
          addresses: [acceptedAddress, failedAddress, budgetAddress].map((address, index) => ({
            id: String(index),
            address,
            derivationPath: `m/84'/0'/0'/0/${index}`,
          })) as any,
          client: mockElectrumClient as any,
          attemptRuntime: {
            signal: new AbortController().signal,
            deadlineAt: now + 100,
            phaseProgress,
          },
        });

        const pending = fetchHistoriesPhase(ctx).then(
          result => result,
          error => error as unknown,
        );
        await vi.advanceTimersByTimeAsync(100);
        const result = await pending as SyncContext;

        expect(result).toBe(ctx);
        if (result !== ctx) return;
        expect(result.historyResults.get(acceptedAddress)).toEqual(acceptedHistory);
        expect(result.historyResults.get(failedAddress)).toEqual([]);
        expect(result.historyResults.get(budgetAddress)).toEqual([]);
        expect(result.rejectedEvidenceCount).toBe(2);
        expect(result.rejectedEvidenceReasons).toEqual(new Map([
          ['history_fetch_failed', 1],
          ['fetch_budget_exhausted', 1],
        ]));
        expect(phaseProgress.budgetExpired).toHaveBeenCalledOnce();
        expect(phaseProgress.begin).toHaveBeenCalledWith(
          'address_history',
          'Continuing address-history reconciliation with complete evidence.',
          { completed: 2, total: 3, unit: 'addresses' },
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not swallow attempt cancellation as an empty history', async () => {
      const controller = new AbortController();
      const reason = new Error('attempt cancelled');
      mockElectrumClient.getAddressHistoryBatch.mockImplementation(async () => {
        controller.abort(reason);
        throw reason;
      });
      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1', derivationPath: "m/84'/0'/0'/0/0" } as any],
        client: mockElectrumClient as any,
        attemptRuntime: { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
      });

      await expect(fetchHistoriesPhase(ctx)).rejects.toBe(reason);
      expect(mockElectrumClient.getAddressHistory).not.toHaveBeenCalled();
    });

    it('should fetch histories for all addresses', async () => {
      const addr1 = 'tb1qaddr1';
      const addr2 = 'tb1qaddr2';

      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([
          [addr1, [{ tx_hash: 'a'.repeat(64), height: 800000 }]],
          [addr2, [{ tx_hash: 'b'.repeat(64), height: 800001 }]],
        ])
      );

      const ctx = createTestContext({
        addresses: [
          { id: '1', address: addr1, derivationPath: "m/84'/0'/0'/0/0" } as any,
          { id: '2', address: addr2, derivationPath: "m/84'/0'/0'/0/1" } as any,
        ],
        addressMap: new Map([
          [addr1, { id: '1', address: addr1, scriptPubKey: '0014' }],
          [addr2, { id: '2', address: addr2, scriptPubKey: '0014' }],
        ]) as any,
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.size).toBe(2);
      expect(result.allTxids.size).toBe(2);
      expect(result.stats.historiesFetched).toBe(2);
    });

    it('should handle empty address list', async () => {
      const ctx = createTestContext({
        addresses: [],
        client: mockElectrumClient as any,
        addressMap: new Map([['addr1', { id: '1', address: 'addr1', scriptPubKey: '0014' }]]) as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.size).toBe(0);
      expect(result.allTxids.size).toBe(0);
    });

    it('makes a missing batch history result retryable', async () => {
      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map());
      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1', derivationPath: "m/84'/0'/0'/0/0" } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.get('addr1')).toEqual([]);
      expect(result.rejectedEvidenceCount).toBe(1);
    });

    it('fails oversized history batches closed without repeating individual requests', async () => {
      mockElectrumClient.getAddressHistoryBatch.mockRejectedValue(
        new ElectrumFrameTooLargeError(17, 16),
      );
      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1', derivationPath: "m/84'/0'/0'/0/0" } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.get('addr1')).toEqual([]);
      expect(result.rejectedEvidenceReasons).toEqual(new Map([
        ['response_frame_too_large', 1],
      ]));
      expect(mockElectrumClient.getAddressHistory).not.toHaveBeenCalled();
    });

    it('should deduplicate txids from multiple addresses', async () => {
      const sharedTxid = 'shared'.padEnd(64, 'a');

      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([
          ['addr1', [{ tx_hash: sharedTxid, height: 800000 }]],
          ['addr2', [{ tx_hash: sharedTxid, height: 800000 }]],
        ])
      );

      const ctx = createTestContext({
        addresses: [
          { id: '1', address: 'addr1', derivationPath: "m/84'/0'/0'/0/0" } as any,
          { id: '2', address: 'addr2', derivationPath: "m/84'/0'/0'/0/1" } as any,
        ],
        client: mockElectrumClient as any,
        addressMap: new Map([['addr1', { id: '1', address: 'addr1', scriptPubKey: '0014' }]]) as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.allTxids.size).toBe(1);
      expect(result.allTxids.has(sharedTxid)).toBe(true);
    });

    it('should fall back to individual requests on batch failure', async () => {
      mockElectrumClient.getAddressHistoryBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getAddressHistory.mockResolvedValue([
        { tx_hash: 'c'.repeat(64), height: 800000 },
      ]);

      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1', derivationPath: "m/84'/0'/0'/0/0" } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.size).toBe(1);
      expect(mockElectrumClient.getAddressHistory).toHaveBeenCalled();
    });

    it('should store empty history when individual fallback request fails', async () => {
      mockElectrumClient.getAddressHistoryBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getAddressHistory.mockRejectedValue(new Error('Individual failed'));

      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1', derivationPath: "m/84'/0'/0'/0/0" } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.get('addr1')).toEqual([]);
      expect(result.rejectedEvidenceCount).toBe(1);
    });

    it('should emit debug progress logs for large address batches', async () => {
      const addresses = Array.from({ length: 51 }, (_, i) => ({
        id: String(i),
        address: `addr-${i}`,
        derivationPath: `m/84'/0'/0'/0/${i}`,
      })) as any[];
      const batchResult = new Map(addresses.map((a: any) => [a.address, []]));
      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(batchResult);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        addresses,
        client: mockElectrumClient as any,
      });

      await fetchHistoriesPhase(ctx);

      expect(walletLog).toHaveBeenCalledWith(
        'test-wallet',
        'debug',
        'SYNC',
        expect.stringContaining('Address history batch 1/2')
      );
    });
  });

  describe('checkExistingPhase', () => {
    it('revisits stale or incomplete classifications across every type', async () => {
      const incompleteReceivedTxid = 'incomplete'.padEnd(64, 'a');
      const completeReceivedTxid = 'complete'.padEnd(64, 'e');
      const consolidationTxid = 'consolidation'.padEnd(64, 'c');
      const sentTxid = 'sent'.padEnd(64, 'd');
      const newTxid = 'new'.padEnd(64, 'b');

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        {
          txid: incompleteReceivedTxid,
          type: 'received',
          classificationInputsComplete: false,
          classificationVersion: 2,
          classificationAddressCount: 0,
          classificationLastAttemptAt: new Date('2026-01-03T00:00:00.000Z'),
          ioComplete: true,
          ioLastAttemptAt: null,
        },
        {
          txid: completeReceivedTxid,
          type: 'received',
          classificationInputsComplete: true,
          classificationVersion: 2,
          classificationAddressCount: 0,
          classificationLastAttemptAt: null,
          ioComplete: true,
          ioLastAttemptAt: null,
        },
        {
          txid: consolidationTxid,
          type: 'consolidation',
          classificationInputsComplete: false,
          classificationVersion: 2,
          classificationAddressCount: 0,
          classificationLastAttemptAt: null,
          ioComplete: true,
          ioLastAttemptAt: null,
        },
        {
          txid: sentTxid,
          type: 'sent',
          classificationInputsComplete: true,
          classificationVersion: 1,
          classificationAddressCount: 0,
          classificationLastAttemptAt: null,
          ioComplete: true,
          ioLastAttemptAt: null,
        },
      ]);

      const ctx = createTestContext({
        allTxids: new Set([
          incompleteReceivedTxid,
          completeReceivedTxid,
          consolidationTxid,
          sentTxid,
          newTxid,
        ]),
      });

      const result = await checkExistingPhase(ctx);

      expect(result.newTxids).toContain(newTxid);
      expect(result.newTxids).toContain(incompleteReceivedTxid);
      expect(result.newTxids).toContain(consolidationTxid);
      expect(result.newTxids).not.toContain(completeReceivedTxid);
      expect(result.newTxids).toContain(sentTxid);
      expect(result.existingTxidSet.has(incompleteReceivedTxid)).toBe(true);
      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            txid: true,
            type: true,
            classificationInputsComplete: true,
            classificationVersion: true,
            classificationAddressCount: true,
            classificationLastAttemptAt: true,
            ioComplete: true,
            ioLastAttemptAt: true,
          },
        })
      );
    });

    it('revisits a current classification targeted by new-address history', async () => {
      const txid = 'ownership-growth'.padEnd(64, 'a');
      mockPrismaClient.transaction.findMany.mockResolvedValue([{
        txid,
        type: 'received',
        classificationInputsComplete: true,
        classificationVersion: 2,
        classificationAddressCount: 1,
        classificationLastAttemptAt: null,
        ioComplete: true,
        ioLastAttemptAt: null,
      }]);
      mockPrismaClient.transactionOwnershipRepair.findMany.mockResolvedValue([{
        txid,
        targetAddressCount: 2,
      }]);

      const result = await checkExistingPhase(createTestContext({
        allTxids: new Set([txid]),
      }));

      expect(result.classificationRepairTxids).toEqual(new Set([txid]));
      expect(result.newTxids).toEqual([txid]);
    });

    it('caps repair work and rotates a permanently unresolved oldest attempt behind the backlog', async () => {
      const repairRows = [];
      for (let index = 0; index <= CLASSIFICATION_REPAIR_CANDIDATE_LIMIT; index += 1) {
        repairRows.push({
          txid: `repair-${String(index).padStart(3, '0')}`.padEnd(64, 'a'),
          type: 'received',
          classificationInputsComplete: false,
          classificationVersion: 2,
          classificationLastAttemptAt: index < 2
            ? null
            : new Date(Date.UTC(2026, 0, 1, 0, 0, Math.max(0, index - 2))),
          ioComplete: true,
          ioLastAttemptAt: null,
        });
      }
      const sentTxid = 'aaa-terminal-sent'.padEnd(64, 's');
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        ...repairRows,
        {
          txid: sentTxid,
          type: 'sent',
          classificationInputsComplete: false,
          classificationVersion: 2,
          classificationLastAttemptAt: null,
          ioComplete: true,
          ioLastAttemptAt: null,
        },
      ]);
      const ctx = createTestContext({
        allTxids: new Set([...repairRows.map(row => row.txid), sentTxid]),
      });

      const first = await checkExistingPhase(ctx);
      expect(first.newTxids).toHaveLength(CLASSIFICATION_REPAIR_CANDIDATE_LIMIT);
      expect(first.newTxids).toContain(repairRows[0].txid);
      expect(first.newTxids).not.toContain(repairRows.at(-1)!.txid);
      expect(first.newTxids).toContain(sentTxid);

      repairRows[0].classificationLastAttemptAt = new Date('2027-01-01T00:00:00.000Z');
      const second = await checkExistingPhase(ctx);
      expect(second.newTxids).toHaveLength(CLASSIFICATION_REPAIR_CANDIDATE_LIMIT);
      expect(second.newTxids).not.toContain(repairRows[0].txid);
      expect(second.newTxids).toContain(repairRows.at(-2)!.txid);
      expect(second.newTxids).not.toContain(repairRows.at(-1)!.txid);

      repairRows[1].classificationInputsComplete = true;
      const third = await checkExistingPhase(ctx);
      expect(third.newTxids).not.toContain(repairRows[1].txid);
      expect(third.newTxids).toContain(sentTxid);
      expect(third.newTxids).toContain(repairRows.at(-1)!.txid);
    });

    it('selects incomplete I/O fairly across sent and other transaction types', async () => {
      const rows = Array.from({ length: IO_REPAIR_CANDIDATE_LIMIT + 1 }, (_, index) => ({
        txid: `io-${String(index).padStart(3, '0')}`.padEnd(64, 'i'),
        type: index === 0 ? 'sent' : 'received',
        classificationInputsComplete: true,
        classificationVersion: 2,
        classificationLastAttemptAt: null,
        ioComplete: false,
        ioLastAttemptAt: index === 0 ? null : new Date(1_000 + index),
      }));
      mockPrismaClient.transaction.findMany.mockResolvedValue(rows);
      const ctx = createTestContext({ allTxids: new Set(rows.map(row => row.txid)) });

      const result = await checkExistingPhase(ctx);

      expect(result.ioRepairTxids.size).toBe(IO_REPAIR_CANDIDATE_LIMIT);
      expect(result.ioRepairTxids.has(rows[0].txid)).toBe(true);
      expect(result.ioRepairTxids.has(rows.at(-1)!.txid)).toBe(false);
      expect(result.classificationRepairTxids.size).toBe(0);
    });

    it('should handle empty transaction set', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const ctx = createTestContext({
        allTxids: new Set(),
      });

      const result = await checkExistingPhase(ctx);

      expect(result.newTxids).toEqual([]);
      expect(result.existingTxidSet.size).toBe(0);
    });
  });

  describe('fetchUtxosPhase', registerFetchUtxosPhaseTests);

  describe('updateAddressesPhase', () => {
    it('should mark addresses with transactions as used', async () => {
      const usedAddress = 'tb1qused';
      const unusedAddress = 'tb1qunused';
      mockPrismaClient.address.updateMany.mockResolvedValue({ count: 1 });

      const ctx = createTestContext({
        walletId: 'test-wallet',
        addresses: [
          { id: 'addr-1', address: usedAddress, used: false } as any,
          { id: 'addr-2', address: unusedAddress, used: false } as any,
        ],
        historyResults: new Map([
          [usedAddress, [{ tx_hash: 'a'.repeat(64), height: 800000 }]],
          [unusedAddress, []],
        ]),
      });

      await updateAddressesPhase(ctx);

      expect(ctx.stats.addressesUpdated).toBe(1);

      expect(mockPrismaClient.address.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            address: expect.objectContaining({ in: [usedAddress] }),
          }),
          data: { used: true },
        })
      );
    });

    it('should handle no addresses needing update', async () => {
      const ctx = createTestContext({
        walletId: 'test-wallet',
        addresses: [],
        historyResults: new Map(),
      });

      await updateAddressesPhase(ctx);

      expect(mockPrismaClient.address.updateMany).not.toHaveBeenCalled();
    });

    it('should keep stats unchanged when updateMany affects zero rows', async () => {
      mockPrismaClient.address.updateMany.mockResolvedValue({ count: 0 });
      const usedAddress = 'tb1qstillused';

      const ctx = createTestContext({
        walletId: 'test-wallet',
        historyResults: new Map([[usedAddress, [{ tx_hash: 'a'.repeat(64), height: 800000 }]]]),
      });

      await updateAddressesPhase(ctx);

      expect(ctx.stats.addressesUpdated).toBe(0);
    });
  });

  describe('gapLimitPhase', () => {
    const mockDescriptor = "wpkh([12345678/84'/0'/0']xpub6CatWdiZiodmUeTDp...)";

    const mockLockedCoordinates = (
      addresses: Array<{ branch: number; index: number; used: boolean }>,
    ) => {
      const summarize = (branch: 0 | 1) => {
        const rows = addresses.filter((address) => address.branch === branch);
        const maxIndex = rows.length === 0 ? null : Math.max(...rows.map(({ index }) => index));
        const lastUsedIndex = Math.max(-1, ...rows
          .filter(({ used }) => used)
          .map(({ index }) => index));
        const unusedTail = rows.filter(
          ({ index, used }) => !used && index > lastUsedIndex,
        ).length;
        return { branch, maxIndex, unusedTail: BigInt(unusedTail) };
      };
      mockPrismaClient.$queryRaw
        .mockReset()
        .mockResolvedValueOnce([{ id: 'test-wallet', network: 'mainnet' }])
        .mockResolvedValueOnce([summarize(0), summarize(1)]);
    };

    beforeEach(() => {
      mockPrismaClient.$queryRaw.mockResolvedValue([{
        id: 'test-wallet', network: 'mainnet',
      }]);
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: 'test-wallet',
        descriptor: mockDescriptor,
        changeDescriptor: mockDescriptor.replace('/0/*', '/1/*'),
        network: 'mainnet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
        canonicalPolicyVersion: 1,
        devices: [{ device: { type: 'coldcard', model: null } }],
      });
    });

    it('should not generate addresses when gap limit is satisfied', async () => {
      // Create 25 receive addresses with last 20 unused (gap = 20)
      const receiveAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        branch: 0,
        coordinateVersion: 1,
        index: i,
        used: i < 5,
      }));
      // Create 25 change addresses with last 20 unused (gap = 20)
      const changeAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        branch: 1,
        coordinateVersion: 1,
        index: i,
        used: i < 5,
      }));

      mockLockedCoordinates([...receiveAddresses, ...changeAddresses]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        client: mockElectrumClient as any,
      });
      const result = await gapLimitPhase(ctx);

      expect(result.newAddresses.length).toBe(0);
      expect(mockPrismaClient.address.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('should generate addresses when gap limit is not satisfied', async () => {
      // Only 10 addresses with last 5 unused (gap = 5, need 15 more)
      const addresses = Array.from({ length: 10 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        branch: 0,
        coordinateVersion: 1,
        index: i,
        used: i < 5,
      }));

      mockLockedCoordinates(addresses);
      const ctx = createTestContext({ walletId: 'test-wallet' });
      const result = await gapLimitPhase(ctx);

      expect(result.newAddresses.length).toBeGreaterThan(0);
      expect(result.stats.newAddressesGenerated).toBeGreaterThan(0);
    });

    it('should skip wallets without descriptor', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: 'test-wallet',
        descriptor: null,
        network: 'mainnet',
      });

      const ctx = createTestContext({ walletId: 'test-wallet' });
      const result = await gapLimitPhase(ctx);

      expect(result.newAddresses.length).toBe(0);
    });
  });

  describe('fixConsolidationsPhase', () => {
    const walletId = 'test-wallet';

    beforeEach(() => {
      vi.clearAllMocks();
      (prepareMisclassifiedConsolidations as Mock).mockResolvedValue({
        walletId,
        walletAddresses: [],
        candidates: [],
      });
      (persistMisclassifiedConsolidations as Mock).mockImplementation(
        async (plan: { candidates: unknown[] }) => plan.candidates.length,
      );
      (recalculateWalletBalances as Mock).mockResolvedValue(undefined);
    });

    it('should prepare misclassified consolidations outside the mutation transaction', async () => {
      const ctx = createTestContext({ walletId });

      await fixConsolidationsPhase(ctx);

      expect(prepareMisclassifiedConsolidations).toHaveBeenCalledWith(walletId);
      expect(persistMisclassifiedConsolidations).not.toHaveBeenCalled();
    });

    it('should update stats when consolidations are corrected', async () => {
      (prepareMisclassifiedConsolidations as Mock).mockResolvedValue({
        walletId,
        walletAddresses: ['address'],
        candidates: Array.from({ length: 3 }, (_, index) => ({ id: `${index}`, txid: `${index}`, amount: 0n })),
      });

      const ctx = createTestContext({ walletId });
      const result = await fixConsolidationsPhase(ctx);

      expect(result.stats.correctedConsolidations).toBe(3);
    });

    it('should recalculate balances when consolidations are corrected', async () => {
      (prepareMisclassifiedConsolidations as Mock).mockResolvedValue({
        walletId,
        walletAddresses: ['address'],
        candidates: Array.from({ length: 2 }, (_, index) => ({ id: `${index}`, txid: `${index}`, amount: 0n })),
      });

      const ctx = createTestContext({ walletId });
      await fixConsolidationsPhase(ctx);

      expect(recalculateWalletBalances).toHaveBeenCalledWith(
        walletId,
        undefined,
        expect.any(Function),
      );
    });

    it('commits consolidation corrections in bounded chunks before balance recalculation', async () => {
      (prepareMisclassifiedConsolidations as Mock).mockResolvedValue({
        walletId,
        walletAddresses: ['address'],
        candidates: Array.from({ length: 201 }, (_, index) => ({
          id: `${index}`,
          txid: `${index}`,
          amount: 0n,
        })),
      });

      await fixConsolidationsPhase(createTestContext({ walletId }));

      expect(persistMisclassifiedConsolidations).toHaveBeenCalledTimes(3);
      expect((persistMisclassifiedConsolidations as Mock).mock.calls.map(
        ([plan]) => plan.candidates.length,
      )).toEqual([100, 100, 1]);
      expect(recalculateWalletBalances).toHaveBeenCalledOnce();
    });

    it('should not recalculate balances when no corrections needed', async () => {
      const ctx = createTestContext({ walletId });
      await fixConsolidationsPhase(ctx);

      expect(recalculateWalletBalances).not.toHaveBeenCalled();
    });

    it('should return context with stats updated', async () => {
      (prepareMisclassifiedConsolidations as Mock).mockResolvedValue({
        walletId,
        walletAddresses: ['address'],
        candidates: Array.from({ length: 5 }, (_, index) => ({ id: `${index}`, txid: `${index}`, amount: 0n })),
      });

      const ctx = createTestContext({ walletId });
      const result = await fixConsolidationsPhase(ctx);

      expect(result.stats.correctedConsolidations).toBe(5);
      expect(result.walletId).toBe(walletId);
    });
  });
});
