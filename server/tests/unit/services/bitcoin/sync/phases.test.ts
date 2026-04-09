import { vi, Mock } from 'vitest';
/**
 * Sync Phase Tests
 *
 * Unit tests for individual sync pipeline phases.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  resetElectrumMocks,
  createMockTransaction,
  createMockUTXO,
} from '../../../../mocks/electrum';

// Mock Prisma
vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock node client
vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
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
  correctMisclassifiedConsolidations: vi.fn().mockResolvedValue(0),
}));

// Mock address derivation
vi.mock('../../../../../src/services/bitcoin/addressDerivation', () => ({
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
  processTransactionsPhase,
  fetchUtxosPhase,
  reconcileUtxosPhase,
  insertUtxosPhase,
  updateAddressesPhase,
  gapLimitPhase,
  fixConsolidationsPhase,
  type SyncContext,
} from '../../../../../src/services/bitcoin/sync';

// Import the mocked balance calculation to control it per test
import {
  correctMisclassifiedConsolidations,
  recalculateWalletBalances,
} from '../../../../../src/services/bitcoin/utils/balanceCalculation';

// Import block height mock
import { getBlockTimestamp } from '../../../../../src/services/bitcoin/utils/blockHeight';
import { getNotificationService, walletLog } from '../../../../../src/websocket/notifications';
import { notifyNewTransactions } from '../../../../../src/services/notifications/notificationService';

describe('Sync Phases', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
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
      });

      const result = await fetchHistoriesPhase(ctx);

      expect(result.historyResults.size).toBe(0);
      expect(result.allTxids.size).toBe(0);
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
    it('should identify new transactions', async () => {
      const existingTxid = 'existing'.padEnd(64, 'a');
      const newTxid = 'new'.padEnd(64, 'b');

      mockPrismaClient.transaction.findMany.mockResolvedValue([
        { txid: existingTxid, type: 'received' },
      ]);

      const ctx = createTestContext({
        allTxids: new Set([existingTxid, newTxid]),
      });

      const result = await checkExistingPhase(ctx);

      expect(result.newTxids).toContain(newTxid);
      expect(result.newTxids).not.toContain(existingTxid);
      expect(result.existingTxidSet.has(existingTxid)).toBe(true);
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

  describe('fetchUtxosPhase', () => {
    it('should fetch UTXOs for all addresses', async () => {
      const addr1 = 'tb1qaddr1';
      const addr2 = 'tb1qaddr2';

      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([
          [addr1, [createMockUTXO({ value: 100000, height: 800000 })]],
          [addr2, [createMockUTXO({ value: 200000, height: 800001 })]],
        ])
      );

      const ctx = createTestContext({
        addresses: [
          { id: '1', address: addr1 } as any,
          { id: '2', address: addr2 } as any,
        ],
        client: mockElectrumClient as any,
      });

      const result = await fetchUtxosPhase(ctx);

      expect(result.utxoResults.length).toBe(2);
      // utxosFetched counts total UTXO count, not addresses
      expect(result.stats.utxosFetched).toBeGreaterThanOrEqual(1);
    });

    it('should build UTXO data map with correct keys', async () => {
      const txid = 'utxo_tx'.padEnd(64, 'a');
      const vout = 1;

      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([
          ['addr1', [{ tx_hash: txid, tx_pos: vout, value: 50000, height: 800000 }]],
        ])
      );

      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1' } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchUtxosPhase(ctx);

      const key = `${txid}:${vout}`;
      expect(result.allUtxoKeys.has(key)).toBe(true);
      expect(result.utxoDataMap.get(key)).toBeDefined();
      expect(result.utxoDataMap.get(key)?.address).toBe('addr1');
    });

    it('should fall back to individual requests on batch failure', async () => {
      mockElectrumClient.getAddressUTXOsBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([
        createMockUTXO({ value: 75000, height: 800000 }),
      ]);

      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1' } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchUtxosPhase(ctx);

      expect(result.utxoResults.length).toBe(1);
      expect(mockElectrumClient.getAddressUTXOs).toHaveBeenCalled();
    });

    it('should continue when individual UTXO fallback fails for an address', async () => {
      mockElectrumClient.getAddressUTXOsBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getAddressUTXOs.mockRejectedValue(new Error('Address lookup failed'));

      const ctx = createTestContext({
        addresses: [{ id: '1', address: 'addr1' } as any],
        client: mockElectrumClient as any,
      });

      const result = await fetchUtxosPhase(ctx);

      expect(result.utxoResults).toEqual([]);
      expect(result.successfullyFetchedAddresses.size).toBe(0);
      expect(mockElectrumClient.getAddressUTXOs).toHaveBeenCalledWith('addr1');
    });
  });


  // reconcileUtxosPhase tests in phases.utxoReconciliation.test.ts

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

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: 'test-wallet',
        descriptor: mockDescriptor,
        network: 'mainnet',
      });
    });

    it('should not generate addresses when gap limit is satisfied', async () => {
      // Create 25 receive addresses with last 20 unused (gap = 20)
      const receiveAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i < 5,
      }));
      // Create 25 change addresses with last 20 unused (gap = 20)
      const changeAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: i < 5,
      }));

      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        client: mockElectrumClient as any,
      });
      const result = await gapLimitPhase(ctx);

      expect(result.newAddresses.length).toBe(0);
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it('should generate addresses when gap limit is not satisfied', async () => {
      // Only 10 addresses with last 5 unused (gap = 5, need 15 more)
      const addresses = Array.from({ length: 10 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i < 5,
      }));

      mockPrismaClient.address.findMany.mockResolvedValue(addresses);
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 15 });

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


  // processTransactionsPhase tests moved to phases.processTransactions.test.ts


  // insertUtxosPhase tests in phases.utxoReconciliation.test.ts

  describe('fixConsolidationsPhase', () => {
    const walletId = 'test-wallet';

    beforeEach(() => {
      vi.clearAllMocks();
      (correctMisclassifiedConsolidations as Mock).mockResolvedValue(0);
      (recalculateWalletBalances as Mock).mockResolvedValue(undefined);
    });

    it('should call correctMisclassifiedConsolidations with wallet ID', async () => {
      const ctx = createTestContext({ walletId });

      await fixConsolidationsPhase(ctx);

      expect(correctMisclassifiedConsolidations).toHaveBeenCalledWith(walletId);
    });

    it('should update stats when consolidations are corrected', async () => {
      (correctMisclassifiedConsolidations as Mock).mockResolvedValue(3);

      const ctx = createTestContext({ walletId });
      const result = await fixConsolidationsPhase(ctx);

      expect(result.stats.correctedConsolidations).toBe(3);
    });

    it('should recalculate balances when consolidations are corrected', async () => {
      (correctMisclassifiedConsolidations as Mock).mockResolvedValue(2);

      const ctx = createTestContext({ walletId });
      await fixConsolidationsPhase(ctx);

      expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
    });

    it('should not recalculate balances when no corrections needed', async () => {
      (correctMisclassifiedConsolidations as Mock).mockResolvedValue(0);

      const ctx = createTestContext({ walletId });
      await fixConsolidationsPhase(ctx);

      expect(recalculateWalletBalances).not.toHaveBeenCalled();
    });

    it('should return context with stats updated', async () => {
      (correctMisclassifiedConsolidations as Mock).mockResolvedValue(5);

      const ctx = createTestContext({ walletId });
      const result = await fixConsolidationsPhase(ctx);

      expect(result.stats.correctedConsolidations).toBe(5);
      expect(result.walletId).toBe(walletId);
    });
  });
});
