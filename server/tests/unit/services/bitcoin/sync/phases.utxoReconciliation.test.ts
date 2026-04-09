import { vi, Mock } from 'vitest';
/**
 * Sync Phase Tests — UTXO Reconciliation
 *
 * Unit tests for reconcileUtxosPhase and insertUtxosPhase sync pipeline phases.
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
  reconcileUtxosPhase,
  insertUtxosPhase,
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

  describe('reconcileUtxosPhase', () => {
    it('should mark spent UTXOs', async () => {
      const spentUtxoTxid = 'spent'.padEnd(64, 'a');

      // Existing UTXO in database
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: spentUtxoTxid, vout: 0, spent: false, address: 'addr1' },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(), // UTXO no longer on chain
        successfullyFetchedAddresses: new Set(['addr1']),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: expect.objectContaining({ in: ['utxo-1'] }),
          }),
          data: { spent: true },
        })
      );
    });

    it('should update confirmations for existing UTXOs', async () => {
      const txid = 'existing'.padEnd(64, 'b');

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid, vout: 0, spent: false, confirmations: 5, blockHeight: 799995, address: 'addr1' },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        currentBlockHeight: 800000,
        allUtxoKeys: new Set([`${txid}:0`]),
        successfullyFetchedAddresses: new Set(['addr1']),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr1', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 799995 } }],
        ]),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'utxo-1' },
          data: expect.objectContaining({
            confirmations: 6, // 800000 - 799995 + 1
          }),
        })
      );
    });

    it('should not mark UTXOs as spent for addresses not fetched', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: 'a'.repeat(64), vout: 0, spent: false, address: 'unfetched_addr' },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
        successfullyFetchedAddresses: new Set(['other_addr']), // Different address
      });

      await reconcileUtxosPhase(ctx);

      // Should not mark as spent since we didn't fetch that address
      expect(mockPrismaClient.uTXO.updateMany).not.toHaveBeenCalled();
    });

    it('should invalidate affected drafts and include labels in log message', async () => {
      const spentUtxoTxid = 'spent-with-draft'.padEnd(64, 'f');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: spentUtxoTxid, vout: 0, spent: false, address: 'addr1', confirmations: 1, blockHeight: 799999 },
      ]);
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([
        { draftId: 'draft-1', draft: { id: 'draft-1', label: 'Important Draft', recipient: 'x' } },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
        successfullyFetchedAddresses: new Set(['addr1']),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.draftTransaction.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['draft-1'] } },
      });
      expect(walletLog).toHaveBeenCalledWith(
        'test-wallet',
        'info',
        'DRAFT',
        expect.stringContaining('Important Draft')
      );
    });

    it('should update confirmations and blockHeight for unconfirmed blockchain UTXOs', async () => {
      const txid = 'unconfirmed-existing'.padEnd(64, 'c');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid, vout: 0, spent: false, confirmations: 5, blockHeight: 799995, address: 'addr1' },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        currentBlockHeight: 800000,
        allUtxoKeys: new Set([`${txid}:0`]),
        successfullyFetchedAddresses: new Set(['addr1']),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr1', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 0 } }],
        ]),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'utxo-1' },
          data: expect.objectContaining({
            confirmations: 0,
            blockHeight: null,
          }),
        })
      );
    });

    it('should skip confirmation update when blockchain and database state already match', async () => {
      const txid = 'matching-utxo'.padEnd(64, 'd');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid, vout: 0, spent: false, confirmations: 6, blockHeight: 799995, address: 'addr1' },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        currentBlockHeight: 800000,
        allUtxoKeys: new Set([`${txid}:0`]),
        successfullyFetchedAddresses: new Set(['addr1']),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr1', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 799995 } }],
        ]),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.update).not.toHaveBeenCalled();
    });

    it('should invalidate drafts without appending labels when none exist', async () => {
      const spentUtxoTxid = 'spent-no-label'.padEnd(64, 'e');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: spentUtxoTxid, vout: 0, spent: false, address: 'addr1', confirmations: 1, blockHeight: 799999 },
      ]);
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([
        { draftId: 'draft-2', draft: { id: 'draft-2', label: null, recipient: 'x' } },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
        successfullyFetchedAddresses: new Set(['addr1']),
      });

      await reconcileUtxosPhase(ctx);

      expect(walletLog).toHaveBeenCalledWith(
        'test-wallet',
        'info',
        'DRAFT',
        'Invalidated 1 draft(s) due to spent UTXOs'
      );
    });
  });

  describe('insertUtxosPhase', () => {
    const walletId = 'test-wallet';

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should insert new UTXOs not in database', async () => {
      const txid = 'new_utxo_tx'.padEnd(64, 'a');
      const utxoAddress = 'tb1q_utxo_addr';

      // No existing UTXOs
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 1 });

      // Mock tx details for UTXO
      const mockTx = createMockTransaction({
        txid,
        outputs: [{ value: 0.001, address: utxoAddress }],
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: utxoAddress, utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 800000 } }],
        ]),
        txDetailsCache: new Map([[txid, mockTx]]) as any,
        currentBlockHeight: 800100,
      });

      const result = await insertUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              walletId,
              txid,
              vout: 0,
              address: utxoAddress,
              amount: BigInt(100000),
              spent: false,
            }),
          ]),
          skipDuplicates: true,
        })
      );
      expect(result.stats.utxosCreated).toBe(1);
    });

    it('should skip UTXOs that already exist in database', async () => {
      const txid = 'existing_utxo'.padEnd(64, 'a');

      // UTXO already exists
      mockPrismaClient.uTXO.findMany.mockResolvedValue([{ txid, vout: 0 }]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 0 });

      const ctx = createTestContext({
        walletId,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 800000 } }],
        ]),
        txDetailsCache: new Map(),
      });

      const result = await insertUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
      expect(result.stats.utxosCreated).toBe(0);
    });

    it('should calculate correct confirmations for UTXO', async () => {
      const txid = 'utxo_confs'.padEnd(64, 'a');
      const blockHeight = 800000;
      const currentHeight = 800100;

      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 1 });

      const mockTx = createMockTransaction({
        txid,
        outputs: [{ value: 0.001, address: 'addr' }],
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: blockHeight } }],
        ]),
        txDetailsCache: new Map([[txid, mockTx]]) as any,
        currentBlockHeight: currentHeight,
      });

      await insertUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              confirmations: 101, // currentHeight - blockHeight + 1
              blockHeight: blockHeight,
            }),
          ]),
        })
      );
    });

    it('should handle unconfirmed UTXOs with height 0', async () => {
      const txid = 'unconfirmed_utxo'.padEnd(64, 'a');

      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 1 });

      const mockTx = createMockTransaction({
        txid,
        outputs: [{ value: 0.001, address: 'addr' }],
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 0 } }], // Unconfirmed
        ]),
        txDetailsCache: new Map([[txid, mockTx]]) as any,
        currentBlockHeight: 800100,
      });

      await insertUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              confirmations: 0,
              blockHeight: null,
            }),
          ]),
        })
      );
    });

    it('should fetch transaction details if not in cache', async () => {
      const txid = 'fetch_tx_utxo'.padEnd(64, 'a');

      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 1 });

      const mockTx = createMockTransaction({
        txid,
        outputs: [{ value: 0.001, address: 'addr' }],
      });
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 800000 } }],
        ]),
        txDetailsCache: new Map() as any, // Empty cache
        currentBlockHeight: 800100,
      });

      await insertUtxosPhase(ctx);

      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(txid);
    });

    it('should skip UTXO when fetched transaction details are null', async () => {
      const txid = 'missing_tx_utxo'.padEnd(64, 'a');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 0 });
      mockElectrumClient.getTransaction.mockResolvedValue(null);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 800000 } }],
        ]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await insertUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
      expect(result.stats.utxosCreated).toBe(0);
    });

    it('should skip UTXO when fetching transaction details throws', async () => {
      const txid = 'error_tx_utxo'.padEnd(64, 'a');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 0 });
      mockElectrumClient.getTransaction.mockRejectedValue(new Error('fetch failed'));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 800000 } }],
        ]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await insertUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
      expect(result.stats.utxosCreated).toBe(0);
    });

    it('should ignore UTXO keys missing from utxoDataMap', async () => {
      const txid = 'missing_data_utxo'.padEnd(64, 'a');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 0 });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await insertUtxosPhase(ctx);

      expect(result.stats.utxosCreated).toBe(0);
      expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
    });

    it('should skip UTXO when referenced output index is missing', async () => {
      const txid = 'missing_output_utxo'.padEnd(64, 'a');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 0 });
      const txWithoutRequestedOutput = {
        txid,
        vout: [{ n: 0, value: 0.001, scriptPubKey: { hex: '0014' } }],
      };

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:1`]),
        utxoDataMap: new Map([
          [`${txid}:1`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 1, value: 100000, height: 800000 } }],
        ]),
        txDetailsCache: new Map([[txid, txWithoutRequestedOutput]]) as any,
        currentBlockHeight: 800100,
      });

      const result = await insertUtxosPhase(ctx);

      expect(result.stats.utxosCreated).toBe(0);
      expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
    });

    it('should default scriptPubKey to empty string when output script is missing', async () => {
      const txid = 'missing_script_utxo'.padEnd(64, 'a');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockResolvedValue({ count: 1 });
      const txWithNoScript = {
        txid,
        vout: [{ n: 0, value: 0.001 }],
      };

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 800000 } }],
        ]),
        txDetailsCache: new Map([[txid, txWithNoScript]]) as any,
        currentBlockHeight: 800100,
      });

      await insertUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              scriptPubKey: '',
            }),
          ]),
        })
      );
    });
  });
});
