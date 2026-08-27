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
    const authenticatedExisting = (txid: string, options?: { spent?: boolean; height?: number }) => ({
      row: {
        id: 'utxo-1', txid, vout: 0, spent: options?.spent ?? false,
        confirmations: 5, blockHeight: options?.height ?? 799995,
        address: 'addr1', amount: 100000n, scriptPubKey: '0014aa',
      },
      details: {
        txid, vin: [], vout: [{ n: 0, value: 0.001, scriptPubKey: { hex: '0014aa', address: 'addr1' } }],
      },
    });

    it('marks a UTXO spent only from an authenticated history input', async () => {
      const spentUtxoTxid = 'spent'.padEnd(64, 'a');

      // Existing UTXO in database
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        authenticatedExisting(spentUtxoTxid).row,
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
        authenticatedSpentOutpointKeys: new Set([`${spentUtxoTxid}:0`]),
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
      const evidence = authenticatedExisting(txid);

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        evidence.row,
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        currentBlockHeight: 800000,
        allUtxoKeys: new Set([`${txid}:0`]),
        txDetailsCache: new Map([[txid, evidence.details]]) as any,
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

    it('preserves a UTXO when it is merely omitted from listunspent', async () => {
      const txid = 'a'.repeat(64);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        authenticatedExisting(txid).row,
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.updateMany).not.toHaveBeenCalled();
    });

    it('should invalidate affected drafts and include labels in log message', async () => {
      const spentUtxoTxid = 'spent-with-draft'.padEnd(64, 'f');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        authenticatedExisting(spentUtxoTxid).row,
      ]);
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([
        { draftId: 'draft-1', draft: { id: 'draft-1', label: 'Important Draft', recipient: 'x' } },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
        authenticatedSpentOutpointKeys: new Set([`${spentUtxoTxid}:0`]),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.draftTransaction.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['draft-1'] },
          status: { in: ['unsigned', 'partial', 'signed'] },
        },
      });
      expect(walletLog).toHaveBeenCalledWith(
        'test-wallet',
        'info',
        'DRAFT',
        'Invalidated 1 draft(s) after authenticated UTXO spend evidence'
      );
    });

    it('should update confirmations and blockHeight for unconfirmed blockchain UTXOs', async () => {
      const txid = 'unconfirmed-existing'.padEnd(64, 'c');
      const evidence = authenticatedExisting(txid);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        evidence.row,
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        currentBlockHeight: 800000,
        allUtxoKeys: new Set([`${txid}:0`]),
        txDetailsCache: new Map([[txid, evidence.details]]) as any,
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
      const evidence = authenticatedExisting(txid);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...evidence.row, confirmations: 6 },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        currentBlockHeight: 800000,
        allUtxoKeys: new Set([`${txid}:0`]),
        txDetailsCache: new Map([[txid, evidence.details]]) as any,
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr1', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 799995 } }],
        ]),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.update).not.toHaveBeenCalled();
    });

    it('preserves an existing UTXO when authenticated output evidence conflicts', async () => {
      const txid = 'conflicting-utxo'.padEnd(64, 'e');
      const evidence = authenticatedExisting(txid);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([evidence.row]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        currentBlockHeight: 800000,
        allUtxoKeys: new Set([`${txid}:0`]),
        txDetailsCache: new Map([[txid, {
          ...evidence.details,
          vout: [{
            ...evidence.details.vout[0],
            scriptPubKey: { hex: '0014bb', address: 'addr1' },
          }],
        }]]) as any,
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr1', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 799995 } }],
        ]),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.update).not.toHaveBeenCalled();
      expect(mockPrismaClient.uTXO.updateMany).not.toHaveBeenCalled();
    });

    it('invalidates only drafts locked to an authenticated spent outpoint', async () => {
      const spentUtxoTxid = 'spent-no-label'.padEnd(64, 'e');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        authenticatedExisting(spentUtxoTxid).row,
      ]);
      mockPrismaClient.draftUtxoLock.findMany.mockResolvedValue([
        { draftId: 'draft-2', draft: { id: 'draft-2', label: null, recipient: 'x' } },
      ]);

      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
        authenticatedSpentOutpointKeys: new Set([`${spentUtxoTxid}:0`]),
      });

      await reconcileUtxosPhase(ctx);

      expect(walletLog).toHaveBeenCalledWith(
        'test-wallet',
        'info',
        'DRAFT',
        'Invalidated 1 draft(s) after authenticated UTXO spend evidence'
      );
    });

    it('commits large spent sets in bounded mutation chunks', async () => {
      const rows = Array.from({ length: 201 }, (_, index) => ({
        ...authenticatedExisting(index.toString().padEnd(64, 'a')).row,
        id: `utxo-${index}`,
      }));
      mockPrismaClient.uTXO.findMany.mockResolvedValue(rows);
      const ctx = createTestContext({
        walletId: 'test-wallet',
        allUtxoKeys: new Set(),
        authenticatedSpentOutpointKeys: new Set(rows.map(row => `${row.txid}:0`)),
      });

      await reconcileUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.updateMany).toHaveBeenCalledTimes(3);
      expect(mockPrismaClient.uTXO.updateMany.mock.calls.map(
        ([args]) => args.where.id.in.length,
      )).toEqual([100, 100, 1]);
      expect(ctx.stats.utxosMarkedSpent).toBe(201);
    });
  });

  describe('insertUtxosPhase', () => {
    const walletId = 'test-wallet';

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('does not swallow attempt cancellation while fetching transaction details', async () => {
      const txid = 'cancelled_utxo'.padEnd(64, 'a');
      const controller = new AbortController();
      const reason = new Error('attempt cancelled');
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockElectrumClient.getTransaction.mockImplementation(async () => {
        controller.abort(reason);
        throw reason;
      });
      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        allUtxoKeys: new Set([`${txid}:0`]),
        utxoDataMap: new Map([
          [`${txid}:0`, { address: 'addr', utxo: { tx_hash: txid, tx_pos: 0, value: 100000, height: 800000 } }],
        ]),
        txDetailsCache: new Map() as any,
        attemptRuntime: { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
      });

      await expect(insertUtxosPhase(ctx)).rejects.toBe(reason);
      expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
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

    it('should commit large UTXO insertions in bounded fenced chunks', async () => {
      const entries = Array.from({ length: 201 }, (_, index) => {
        const txid = index.toString(16).padStart(64, '0');
        const address = `tb1q_batch_${index}`;
        return {
          key: `${txid}:0`,
          data: {
            address,
            utxo: { tx_hash: txid, tx_pos: 0, value: 1000, height: 800000 },
          },
          transaction: createMockTransaction({
            txid,
            outputs: [{ value: 0.00001, address }],
          }),
        };
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.createMany.mockImplementation(async ({ data }) => ({
        count: data.length,
      }));

      const ctx = createTestContext({
        walletId,
        allUtxoKeys: new Set(entries.map(entry => entry.key)),
        utxoDataMap: new Map(entries.map(entry => [entry.key, entry.data])),
        txDetailsCache: new Map(entries.map(entry => [entry.data.utxo.tx_hash, entry.transaction])) as any,
        currentBlockHeight: 800100,
      });

      await insertUtxosPhase(ctx);

      expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledTimes(3);
      expect(mockPrismaClient.uTXO.createMany.mock.calls.map(
        ([args]) => args.data.length,
      )).toEqual([100, 100, 1]);
      expect(ctx.stats.utxosCreated).toBe(201);
      expect(walletLog).toHaveBeenCalledTimes(3);
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
