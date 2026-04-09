import { vi, Mock } from 'vitest';
/**
 * Sync Phase Tests — processTransactionsPhase
 *
 * Unit tests for the processTransactionsPhase sync pipeline phase.
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
  processTransactionsPhase,
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

  describe('processTransactionsPhase', () => {
    const walletId = 'test-wallet';

    beforeEach(() => {
      vi.clearAllMocks();
      // Default mock for transaction operations
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.transactionInput.createMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.transactionOutput.createMany.mockResolvedValue({ count: 0 });
      mockPrismaClient.addressLabel.findMany.mockResolvedValue([]);
    });

    it('should return early when no new txids to process', async () => {
      const ctx = createTestContext({
        walletId,
        newTxids: [],
        historyResults: new Map(),
      });

      const result = await processTransactionsPhase(ctx);

      expect(result.stats.newTransactionsCreated).toBe(0);
      expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    });

    it('should classify transaction as received when external inputs only', async () => {
      const txid = 'received_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';

      // Mock transaction with external input, output to wallet
      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev_tx'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress }],
        outputs: [{ value: 0.00099, address: walletAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'received',
              amount: BigInt(99000), // 0.00099 BTC in sats
            }),
          ]),
        })
      );
    });

    it('should classify transaction as sent when wallet inputs go to external', async () => {
      const txid = 'sent_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      const changeAddress = 'tb1q_change_addr';

      // Mock transaction: wallet input, external output + change
      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev_tx'.padEnd(64, 'b'), vout: 0, value: 0.01, address: walletAddress }],
        outputs: [
          { value: 0.005, address: externalAddress },
          { value: 0.0049, address: changeAddress },
        ],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress, changeAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'sent',
              // Sent amount is negative: -(external + fee)
            }),
          ]),
        })
      );
    });

    it('should classify transaction as consolidation when all outputs to wallet', async () => {
      const txid = 'consolidation_tx'.padEnd(64, 'a');
      const inputAddr1 = 'tb1q_input1';
      const inputAddr2 = 'tb1q_input2';
      const outputAddr = 'tb1q_output';

      // Mock consolidation: multiple wallet inputs, single wallet output
      const mockTx = createMockTransaction({
        txid,
        inputs: [
          { txid: 'prev_tx1'.padEnd(64, 'b'), vout: 0, value: 0.01, address: inputAddr1 },
          { txid: 'prev_tx2'.padEnd(64, 'c'), vout: 0, value: 0.01, address: inputAddr2 },
        ],
        outputs: [{ value: 0.0199, address: outputAddr }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[inputAddr1, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([inputAddr1, inputAddr2, outputAddr]),
        addressMap: new Map([[inputAddr1, { id: 'addr-1', address: inputAddr1 } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'consolidation',
            }),
          ]),
        })
      );
    });

    it('should set rbfStatus to active for unconfirmed transactions', async () => {
      const txid = 'unconfirmed_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';
      const externalAddress = 'tb1q_external';

      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]), // height 0 = unconfirmed
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              rbfStatus: 'active',
              confirmations: 0,
            }),
          ]),
        })
      );
    });

    it('should set rbfStatus to confirmed for confirmed transactions', async () => {
      const txid = 'confirmed_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';
      const externalAddress = 'tb1q_external';

      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              rbfStatus: 'confirmed',
              confirmations: 101, // 800100 - 800000 + 1
            }),
          ]),
        })
      );
    });

    it('should calculate fee for sent transactions', async () => {
      const txid = 'sent_with_fee'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';
      const externalAddress = 'tb1q_external';

      // Input: 1,000,000 sats, Output: 990,000 sats, Fee: 10,000 sats
      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.01, address: walletAddress }],
        outputs: [{ value: 0.0099, address: externalAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'sent',
              fee: BigInt(10000), // 0.01 - 0.0099 = 0.0001 BTC = 10000 sats
            }),
          ]),
        })
      );
    });

    it('should fall back to individual requests when batch fetch fails', async () => {
      const txid = 'fallback_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';

      mockElectrumClient.getTransactionsBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getTransaction.mockResolvedValue(
        createMockTransaction({
          txid,
          inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
          outputs: [{ value: 0.0009, address: walletAddress }],
        })
      );

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(txid, true);
    });

    it('should update stats with processed transaction counts', async () => {
      const txid = 'stats_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(
        new Map([[txid, createMockTransaction({
          txid,
          inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
          outputs: [{ value: 0.0009, address: walletAddress }],
        })]])
      );

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await processTransactionsPhase(ctx);

      expect(result.stats.transactionsProcessed).toBe(1);
    });

    it('should classify coinbase transaction as received', async () => {
      const txid = 'coinbase_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_miner_addr';

      // Coinbase transaction: no regular inputs, just block reward output
      const mockTx = createMockTransaction({
        txid,
        coinbase: true, // Special flag for coinbase tx
        outputs: [
          { value: 6.25, address: walletAddress }, // Block reward
        ],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'received',
              amount: BigInt(625000000), // 6.25 BTC in sats
              // Received transactions don't have a fee field (no inputs from wallet)
            }),
          ]),
        })
      );

      // Verify it was NOT classified as sent (coinbase inputs should be ignored)
      const createManyCall = mockPrismaClient.transaction.createMany.mock.calls[0][0];
      const txData = createManyCall.data[0];
      expect(txData.type).toBe('received');
      expect(txData.fee).toBeUndefined(); // No fee for received transactions
    });

    it('should calculate correct sent amount for multi-output transaction', async () => {
      const txid = 'multi_output'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';
      const changeAddress = 'tb1q_change';
      const recipient1 = 'tb1q_recipient1';
      const recipient2 = 'tb1q_recipient2';
      const recipient3 = 'tb1q_recipient3';

      // Wallet sends to 3 external addresses with change back
      // Input: 1.0 BTC, Outputs: 0.3 + 0.2 + 0.1 (external) + 0.39 (change) = 0.99
      // Fee: 0.01 BTC = 1,000,000 sats
      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 1.0, address: walletAddress }],
        outputs: [
          { value: 0.3, address: recipient1 },
          { value: 0.2, address: recipient2 },
          { value: 0.1, address: recipient3 },
          { value: 0.39, address: changeAddress },
        ],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress, changeAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      // Sent amount = -(totalToExternal + fee) = -(60,000,000 + 1,000,000) = -61,000,000
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'sent',
              amount: BigInt(-61000000), // 0.3 + 0.2 + 0.1 + 0.01 fee = 0.61 BTC
              fee: BigInt(1000000), // 0.01 BTC fee
            }),
          ]),
        })
      );
    });

    it('should store transaction inputs and outputs via storeTransactionIO', async () => {
      const txid = 'io_test_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';
      const externalAddress = 'tb1q_external';

      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.01, address: walletAddress }],
        outputs: [
          { value: 0.005, address: externalAddress },
          { value: 0.004, address: walletAddress },
        ],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      // Mock transaction.findMany to handle different query types
      let storeIOCalled = false;
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        // RBF cleanup query (pending transactions)
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [];
        }
        // Check existing query (has select: { txid: true }) - return empty so tx is created
        if (args?.select?.txid && !args?.select?.id) {
          return [];
        }
        // storeTransactionIO query (has select: { id, txid, type }) - return the created record
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          storeIOCalled = true;
          return [{ id: 'tx-record-1', txid, type: 'sent' }];
        }
        return [];
      });

      // Pre-populate txDetailsCache (normally done by batch fetch)
      const txDetailsCache = new Map([[txid, mockTx]]) as any;

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        addressToDerivationPath: new Map([[walletAddress, "m/84'/0'/0'/0/0"]]),
        existingTxMap: new Map(),
        txDetailsCache,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      // Verify inputs were stored
      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              transactionId: 'tx-record-1',
              inputIndex: 0,
              txid: 'prev'.padEnd(64, 'b'),
              vout: 0,
              address: walletAddress,
              amount: BigInt(1000000), // 0.01 BTC
              derivationPath: "m/84'/0'/0'/0/0",
            }),
          ]),
          skipDuplicates: true,
        })
      );

      // Verify outputs were stored
      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              transactionId: 'tx-record-1',
              outputIndex: 0,
              address: externalAddress,
              amount: BigInt(500000), // 0.005 BTC
              outputType: 'recipient',
              isOurs: false,
            }),
            expect.objectContaining({
              transactionId: 'tx-record-1',
              outputIndex: 1,
              address: walletAddress,
              amount: BigInt(400000), // 0.004 BTC
              outputType: 'change',
              isOurs: true,
            }),
          ]),
          skipDuplicates: true,
        })
      );
    });

    it('should batch prefetch previous transactions for input resolution', async () => {
      const walletAddress = 'tb1q_wallet';
      const txid = 'main_tx'.padEnd(64, 'a');
      const prevTxid1 = 'prev_tx_1'.padEnd(64, 'b');
      const prevTxid2 = 'prev_tx_2'.padEnd(64, 'c');

      // Main transaction with inputs that need prev TX lookup (no inline prevout)
      const mainTx = {
        txid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [
          { txid: prevTxid1, vout: 0 }, // No prevout - needs lookup
          { txid: prevTxid2, vout: 1 }, // No prevout - needs lookup
        ],
        vout: [{
          value: 0.009,
          n: 0,
          scriptPubKey: { hex: '0014...', address: walletAddress },
        }],
      };

      // Previous transactions to be batch prefetched
      const prevTx1 = {
        txid: prevTxid1,
        hex: '01000000...',
        vout: [{
          value: 0.005,
          n: 0,
          scriptPubKey: { hex: '0014...', address: 'external_sender1' },
        }],
      };

      const prevTx2 = {
        txid: prevTxid2,
        hex: '01000000...',
        vout: [{
          value: 0,
          n: 0,
          scriptPubKey: { hex: '0014...', address: 'other' },
        }, {
          value: 0.005,
          n: 1,
          scriptPubKey: { hex: '0014...', address: 'external_sender2' },
        }],
      };

      const batchCalls: string[][] = [];
      mockElectrumClient.getTransactionsBatch.mockImplementation(async (txidBatch: string[]) => {
        batchCalls.push([...txidBatch]);
        const result = new Map();
        for (const id of txidBatch) {
          if (id === txid) result.set(id, mainTx);
          else if (id === prevTxid1) result.set(id, prevTx1);
          else if (id === prevTxid2) result.set(id, prevTx2);
        }
        return result;
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      // Should have made 2 batch calls: one for main TX, one for prev TXs
      expect(batchCalls.length).toBe(2);
      expect(batchCalls[0]).toContain(txid);
      // Second batch should contain both prev txids for batch prefetch
      expect(batchCalls[1]).toContain(prevTxid1);
      expect(batchCalls[1]).toContain(prevTxid2);

      // Should NOT have made individual getTransaction calls (all prefetched in batch)
      expect(mockElectrumClient.getTransaction).not.toHaveBeenCalled();
    });

    it('should process large batch of transactions (50+ txs)', async () => {
      const walletAddress = 'tb1q_wallet';
      const txCount = 55; // More than TX_BATCH_SIZE (25)

      // Create 55 transactions with verbose prevout (no separate prev TX fetch needed)
      const txids: string[] = [];
      const txMap = new Map();
      const historyEntries: Array<{ tx_hash: string; height: number }> = [];

      for (let i = 0; i < txCount; i++) {
        const txid = `tx_${i.toString().padStart(3, '0')}`.padEnd(64, 'a');
        txids.push(txid);
        // Use verbose prevout in inputs to avoid prev TX prefetching
        txMap.set(txid, {
          txid,
          hex: '01000000...',
          confirmations: 100,
          time: Date.now() / 1000,
          vin: [{
            txid: 'prev'.padEnd(64, 'b'),
            vout: i,
            prevout: {
              value: 0.001,
              scriptPubKey: { hex: '0014...', address: 'external' },
            },
          }],
          vout: [{
            value: 0.0009,
            n: 0,
            scriptPubKey: { hex: '0014...', address: walletAddress },
          }],
        });
        historyEntries.push({ tx_hash: txid, height: 800000 });
      }

      mockElectrumClient.getTransactionsBatch.mockImplementation(async (txidBatch: string[]) => {
        const result = new Map();
        for (const txid of txidBatch) {
          if (txMap.has(txid)) {
            result.set(txid, txMap.get(txid));
          }
        }
        return result;
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: txids,
        historyResults: new Map([[walletAddress, historyEntries]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await processTransactionsPhase(ctx);

      // Should have processed all transactions across multiple batches
      expect(result.stats.transactionsProcessed).toBe(txCount);

      // getTransactionsBatch should have been called multiple times (3 batches for 55 txs with batch size 25)
      // No prev TX prefetch needed since we have verbose prevout
      expect(mockElectrumClient.getTransactionsBatch).toHaveBeenCalledTimes(3);
    });

    it('should preserve partial results when batch fetch fails mid-processing', async () => {
      const walletAddress = 'tb1q_wallet';
      const successTxid = 'success_tx'.padEnd(64, 'a');
      const failBatchTxid = 'fail_batch'.padEnd(64, 'b');

      // First batch succeeds - use verbose prevout to skip prev TX prefetch
      const successTx = {
        txid: successTxid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [{
          txid: 'prev'.padEnd(64, 'c'),
          vout: 0,
          prevout: {
            value: 0.001,
            scriptPubKey: { hex: '0014...', address: 'external' },
          },
        }],
        vout: [{
          value: 0.0009,
          n: 0,
          scriptPubKey: { hex: '0014...', address: walletAddress },
        }],
      };

      // Second batch fails, but individual fallback works
      const failTx = {
        txid: failBatchTxid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [{
          txid: 'prev'.padEnd(64, 'd'),
          vout: 0,
          prevout: {
            value: 0.002,
            scriptPubKey: { hex: '0014...', address: 'external' },
          },
        }],
        vout: [{
          value: 0.0019,
          n: 0,
          scriptPubKey: { hex: '0014...', address: walletAddress },
        }],
      };

      let batchCallCount = 0;
      mockElectrumClient.getTransactionsBatch.mockImplementation(async (txidBatch: string[]) => {
        batchCallCount++;
        if (batchCallCount === 1) {
          // First batch succeeds - return all 25 txids from first batch
          const result = new Map<string, typeof successTx>();
          for (const txid of txidBatch) {
            if (txid === successTxid) {
              result.set(txid, successTx);
            }
          }
          return result;
        }
        // Second batch fails
        throw new Error('Batch failed');
      });

      // Individual fallback succeeds
      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === failBatchTxid) return failTx;
        return null;
      });

      // Need 26+ txids to trigger second batch (batch size is 25)
      const txids = [successTxid];
      for (let i = 0; i < 25; i++) {
        txids.push(`padding_${i.toString().padStart(2, '0')}`.padEnd(64, 'x')); // Padding txids
      }
      txids.push(failBatchTxid);

      const historyEntries = txids.map(tx_hash => ({ tx_hash, height: 800000 }));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: txids,
        historyResults: new Map([[walletAddress, historyEntries]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      // Should have fallen back to individual requests for failed batch
      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(failBatchTxid, true);

      // Should have created transactions for both successful batch and fallback
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalled();
    });

    it('should mark pending active RBF transactions as replaced when confirmed tx reuses input', async () => {
      const txid = 'confirmed_in_phase'.padEnd(64, 'a');
      const pendingTxid = 'pending_in_phase'.padEnd(64, 'b');
      const sharedInputTxid = 'shared_input'.padEnd(64, 'c');
      const walletAddress = 'tb1q_wallet_rbf';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: sharedInputTxid, vout: 0, value: 0.001, address: 'external' }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));

      const updateCalls: any[] = [];
      mockPrismaClient.transaction.update.mockImplementation(async (args: any) => {
        updateCalls.push(args);
        return args;
      });
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        // Step 3 existing tx check
        if (args?.select?.txid && !args?.select?.id) {
          return [];
        }
        // storeTransactionIO fetch of created tx rows
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'confirmed-row-id', txid, type: 'received' }];
        }
        // detectRBFReplacements pending tx query
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [{
            id: 'pending-row-id',
            txid: pendingTxid,
            inputs: [{ txid: sharedInputTxid, vout: 0 }],
          }];
        }
        // applyAddressLabels tx lookup
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) {
          return [];
        }
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-rbf', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(updateCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            where: { id: 'pending-row-id' },
            data: expect.objectContaining({
              rbfStatus: 'replaced',
              replacedByTxid: txid,
            }),
          }),
        ])
      );
    });

    it('should auto-apply address labels to created transactions', async () => {
      const txid = 'label_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));
      mockPrismaClient.addressLabel.findMany.mockResolvedValue([
        { addressId: 'addr-1', labelId: 'label-1' },
        { addressId: 'addr-1', labelId: 'label-2' },
      ]);
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        // Existing tx check
        if (args?.select?.txid && !args?.select?.id) return [];
        // storeTransactionIO lookup
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-record-1', txid, type: 'received' }];
        }
        // applyAddressLabels lookup
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) {
          return [{ id: 'tx-record-1', txid, addressId: 'addr-1' }];
        }
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transactionLabel.createMany).toHaveBeenCalledWith({
        data: [
          { transactionId: 'tx-record-1', labelId: 'label-1' },
          { transactionId: 'tx-record-1', labelId: 'label-2' },
        ],
        skipDuplicates: true,
      });
    });

    it('should continue when auto-label application fails', async () => {
      const txid = 'label_fail_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));
      mockPrismaClient.addressLabel.findMany.mockRejectedValue(new Error('label lookup failed'));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await expect(processTransactionsPhase(ctx)).resolves.toBeDefined();
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalled();
    });

    it('should handle async push notification failures via catch callback', async () => {
      const txid = 'notify_fail_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      (notifyNewTransactions as unknown as Mock).mockRejectedValueOnce(new Error('push failed'));
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      // Allow queued `.catch(...)` handler to run.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(notifyNewTransactions).toHaveBeenCalled();
    });

    it('should continue when websocket notification broadcasting setup throws', async () => {
      const txid = 'ws_notify_fail'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      (getNotificationService as unknown as Mock).mockImplementationOnce(() => {
        throw new Error('websocket down');
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await expect(processTransactionsPhase(ctx)).resolves.toBeDefined();
      expect(notifyNewTransactions).toHaveBeenCalled();
    });

    it('should continue when individual fallback transaction fetch fails', async () => {
      const txid = 'fallback_individual_fail'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      mockElectrumClient.getTransactionsBatch.mockRejectedValue(new Error('batch failed'));
      mockElectrumClient.getTransaction.mockRejectedValue(new Error('individual failed'));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-fallback', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await expect(processTransactionsPhase(ctx)).resolves.toBeDefined();
      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(txid, true);
      expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    });

    it('should recover from prev-tx prefetch failure using per-input cache miss fallback', async () => {
      const txid = 'prev_prefetch_fallback'.padEnd(64, 'a');
      const prevTxid = 'prev_needs_fetch'.padEnd(64, 'b');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';

      const mainTx = {
        txid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [{ txid: prevTxid, vout: 0 }],
        vout: [{
          value: 0.0008,
          n: 0,
          scriptPubKey: { hex: '0014...', address: externalAddress },
        }],
      };

      const prevTx = {
        txid: prevTxid,
        hex: '01000000...',
        vout: [{
          value: 0.001,
          n: 0,
          scriptPubKey: { hex: '0014...', address: walletAddress },
        }],
      };

      let batchCalls = 0;
      mockElectrumClient.getTransactionsBatch.mockImplementation(async (txidBatch: string[]) => {
        batchCalls += 1;
        if (batchCalls === 1) return new Map([[txidBatch[0], mainTx]]);
        throw new Error('prefetch failed');
      });
      mockElectrumClient.getTransaction.mockImplementation(async (requestedTxid: string) => {
        if (requestedTxid === prevTxid) return prevTx;
        return null;
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-prev-fallback', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockElectrumClient.getTransactionsBatch).toHaveBeenCalledTimes(2);
      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(prevTxid);
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalled();
    });

    it('should skip insert when txid already exists in wallet', async () => {
      const txid = 'existing_txid'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));
      mockPrismaClient.transaction.findMany.mockResolvedValue([{ txid }]);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-existing', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    });

    it('should resolve input address and amount from cached previous tx in storeTransactionIO', async () => {
      const txid = 'store_prev_lookup'.padEnd(64, 'a');
      const prevTxid = 'store_prev_source'.padEnd(64, 'b');
      const walletAddress = 'tb1q_wallet_addr';

      const txDetails = {
        txid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [{ txid: prevTxid, vout: 0 }],
        vout: [{
          value: 0.0009,
          n: 0,
          scriptPubKey: { hex: '0014...', address: walletAddress },
        }],
      };
      const prevTx = {
        txid: prevTxid,
        hex: '01000000...',
        vout: [{
          value: 0.002,
          n: 0,
          scriptPubKey: { hex: '0014...', address: walletAddress },
        }],
      };

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, txDetails], [prevTxid, prevTx]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-record-store', txid, type: 'received' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-store-prev', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid: prevTxid,
              address: walletAddress,
              amount: BigInt(200000),
            }),
          ]),
        }),
      );
    });

    it('should mark external outputs as unknown for received transactions', async () => {
      const txid = 'received_with_external'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.0012, address: externalAddress }],
        outputs: [
          { value: 0.0009, address: walletAddress },
          { value: 0.0002, address: externalAddress },
        ],
      })]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-record-outtype', txid, type: 'received' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-outtype', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              address: externalAddress,
              outputType: 'unknown',
              isOurs: false,
            }),
          ]),
        }),
      );
    });

    it('should mark outputs as consolidation type for consolidation transactions', async () => {
      const txid = 'consolidation_outtype'.padEnd(64, 'a');
      const inputAddress = 'tb1q_input_wallet';
      const outputAddress = 'tb1q_output_wallet';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.003, address: inputAddress }],
        outputs: [{ value: 0.0029, address: outputAddress }],
      })]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-record-consolidation', txid, type: 'consolidation' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[inputAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([inputAddress, outputAddress]),
        addressMap: new Map([[inputAddress, { id: 'addr-consolidation', address: inputAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              address: outputAddress,
              outputType: 'consolidation',
            }),
          ]),
        }),
      );
    });

    it('should continue when storeTransactionIO fails to persist IO rows', async () => {
      const txid = 'store_io_fail'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.002, address: walletAddress }],
        outputs: [{ value: 0.0018, address: externalAddress }],
      })]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-record-io-fail', txid, type: 'sent' }];
        }
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });
      mockPrismaClient.transactionInput.createMany.mockRejectedValue(new Error('input insert failed'));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-io-fail', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await expect(processTransactionsPhase(ctx)).resolves.toBeDefined();
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalled();
      expect(notifyNewTransactions).toHaveBeenCalled();
    });

    it('should classify received outputs that match via scriptPubKey.addresses[]', async () => {
      const txid = 'received_addresses_array'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      const tx = {
        txid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [{
          txid: 'prev'.padEnd(64, 'b'),
          vout: 0,
          prevout: {
            value: 0.001,
            scriptPubKey: { hex: '0014...', address: 'tb1q_external_sender' },
          },
        }],
        vout: [{
          value: 0.0009,
          n: 0,
          scriptPubKey: { hex: '0014...', addresses: [walletAddress] },
        }],
      };
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, tx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-array', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'received',
            }),
          ]),
        }),
      );
    });

    it('should return early from auto-labeling when created transactions have no address ids', async () => {
      const txid = 'label_no_address_id'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        // Force undefined addressId on created transaction rows
        addressMap: new Map([[walletAddress, { id: undefined, address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      expect(mockPrismaClient.addressLabel.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.transactionLabel.createMany).not.toHaveBeenCalled();
    });

    it('should skip RBF linking when there are no confirmed transactions in the processed set', async () => {
      const txid = 'rbf_no_confirmed'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      let pendingRbfQuerySeen = false;

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.002, address: walletAddress }],
        outputs: [{ value: 0.0018, address: externalAddress }],
      })]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          pendingRbfQuerySeen = true;
          return [];
        }
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-rbf-none', txid, type: 'sent' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]), // unconfirmed
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-rbf-none', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      expect(pendingRbfQuerySeen).toBe(false);
    });

    it('should skip RBF linking when confirmed transactions have no captured input patterns', async () => {
      const confirmedTxid = 'rbf_confirmed_coinbase'.padEnd(64, 'a');
      const unconfirmedTxid = 'rbf_unconfirmed_regular'.padEnd(64, 'b');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      let pendingRbfQuerySeen = false;

      const confirmedCoinbase = createMockTransaction({
        txid: confirmedTxid,
        coinbase: true,
        outputs: [{ value: 6.25, address: walletAddress }],
      });
      const unconfirmedRegular = createMockTransaction({
        txid: unconfirmedTxid,
        inputs: [{ txid: 'prev'.padEnd(64, 'c'), vout: 0, value: 0.002, address: walletAddress }],
        outputs: [{ value: 0.0018, address: externalAddress }],
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(
        new Map([
          [confirmedTxid, confirmedCoinbase],
          [unconfirmedTxid, unconfirmedRegular],
        ])
      );
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          pendingRbfQuerySeen = true;
          return [];
        }
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [
            { id: 'tx-confirmed', txid: confirmedTxid, type: 'received' },
            { id: 'tx-unconfirmed', txid: unconfirmedTxid, type: 'sent' },
          ];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [confirmedTxid, unconfirmedTxid],
        historyResults: new Map([[walletAddress, [
          { tx_hash: confirmedTxid, height: 800000 },
          { tx_hash: unconfirmedTxid, height: 0 },
        ]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-rbf-patterns', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      expect(pendingRbfQuerySeen).toBe(false);
    });

    it('should resolve input address from prevout.addresses[] and skip outputs with no decoded address', async () => {
      const txid = 'io_prevout_addresses'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';

      const tx = {
        txid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [{
          txid: 'prev'.padEnd(64, 'b'),
          vout: 0,
          prevout: {
            value: 0.002,
            scriptPubKey: { hex: '0014...', addresses: [walletAddress] },
          },
        }],
        vout: [
          { value: 0.0018, n: 0, scriptPubKey: { hex: '0014...', address: externalAddress } },
          { value: 0.0001, n: 1, scriptPubKey: { hex: '6a24aa21a9ed' } }, // no address -> skipped
        ],
      };
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, tx]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-io-prevout', txid, type: 'sent' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-io-prevout', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              address: walletAddress,
              amount: BigInt(200000),
            }),
          ]),
        })
      );
      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              outputIndex: 0,
              address: externalAddress,
            }),
          ]),
        })
      );
      const outputRows = mockPrismaClient.transactionOutput.createMany.mock.calls.at(-1)?.[0]?.data || [];
      expect(outputRows.some((row: any) => row.outputIndex === 1)).toBe(false);
    });

    it('should ignore tx details that omit vin/vout arrays', async () => {
      const txid = 'missing_vin_vout'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[
        txid,
        {
          txid,
          hex: '01000000...',
          confirmations: 1,
          time: Date.now() / 1000,
          // vin and vout intentionally omitted
        } as any,
      ]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-missing-io', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    });

    it('should treat large prevout values as satoshis for fee and input IO calculations', async () => {
      const txid = 'sats_prevout_value'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      const prevTxid = 'prev'.padEnd(64, 'b');

      const tx = {
        txid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [{
          txid: prevTxid,
          vout: 0,
          prevout: {
            value: 2000000, // already satoshis (>= 1,000,000)
            scriptPubKey: { hex: '0014...', address: walletAddress },
          },
        }],
        vout: [{
          value: 0.019,
          n: 0,
          scriptPubKey: { hex: '0014...', address: externalAddress },
        }],
      };
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, tx]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-sats-prevout', txid, type: 'sent' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-sats-prevout', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'sent',
              fee: BigInt(100000),
            }),
          ]),
        }),
      );
      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid: prevTxid,
              amount: BigInt(2000000),
            }),
          ]),
        }),
      );
    });

    it('should create consolidation rows with null fee when input values are unavailable', async () => {
      const txid = 'consolidation_no_fee'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      const tx = {
        txid,
        hex: '01000000...',
        confirmations: 0,
        time: Date.now() / 1000,
        vin: [{
          txid: 'prev'.padEnd(64, 'b'),
          vout: 0,
          prevout: {
            // no value, so totalInputs stays 0 and fee remains null
            scriptPubKey: { hex: '0014...', address: walletAddress },
          },
        }],
        vout: [{
          value: 0.0009,
          n: 0,
          scriptPubKey: { hex: '0014...', address: walletAddress },
        }],
      };
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, tx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-consolidation-null-fee', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'consolidation',
              amount: BigInt(0),
              fee: null,
              blockHeight: null,
              rbfStatus: 'active',
            }),
          ]),
        }),
      );
    });

    it('should skip RBF replacement updates when replacement txid matches the pending txid', async () => {
      const txid = 'rbf_same_txid'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      const sharedInputTxid = 'shared'.padEnd(64, 'b');

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: sharedInputTxid, vout: 0, value: 0.002, address: walletAddress }],
        outputs: [{ value: 0.0018, address: externalAddress }],
      })]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [{
            id: 'pending-same',
            txid, // same txid as confirmed replacement candidate
            inputs: [{ txid: sharedInputTxid, vout: 0 }],
          }];
        }
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'confirmed-same', txid, type: 'sent' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-rbf-same', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('should skip transaction label creation when returned labels do not match created tx addresses', async () => {
      const txid = 'labels_no_match'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-labels-no-match', txid, type: 'received' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) {
          return [{ id: 'tx-labels-no-match', txid, addressId: 'addr-label-target' }];
        }
        return [];
      });
      mockPrismaClient.addressLabel.findMany.mockResolvedValue([
        { addressId: 'different-address-id', labelId: 'label-1' },
      ] as any);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-label-target', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);
      expect(mockPrismaClient.addressLabel.findMany).toHaveBeenCalled();
      expect(mockPrismaClient.transactionLabel.createMany).not.toHaveBeenCalled();
    });

    it('should persist consolidation outputs and apply matching transaction labels', async () => {
      const txid = 'consolidation_with_labels'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const walletAddressId = 'addr-label-match';
      const inputTxid = 'prev'.padEnd(64, 'b');

      const tx = {
        txid,
        hex: '01000000...',
        confirmations: 120,
        time: Date.now() / 1000,
        vin: [{
          txid: inputTxid,
          vout: 0,
          prevout: {
            value: 0.002,
            scriptPubKey: { hex: '0014...', address: walletAddress },
          },
        }],
        vout: [{
          n: 0,
          value: 0.0019,
          scriptPubKey: { hex: '0014...', address: walletAddress },
        }, {
          n: 1,
          value: 0,
          // use addresses[] to exercise decoded-address fallback and value||0 path
          scriptPubKey: { hex: '0014...', addresses: [walletAddress] },
        }],
      };
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, tx as any]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-consolidation-record', txid, type: 'consolidation' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) {
          return [{ id: 'tx-consolidation-record', txid, addressId: walletAddressId }];
        }
        return [];
      });
      mockPrismaClient.addressLabel.findMany.mockResolvedValue([
        { addressId: walletAddressId, labelId: 'label-1' },
      ] as any);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: walletAddressId, address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              address: walletAddress,
              outputType: 'consolidation',
              isOurs: true,
            }),
            expect.objectContaining({
              outputIndex: 1,
              amount: BigInt(0),
              outputType: 'consolidation',
            }),
          ]),
        }),
      );
      expect(mockPrismaClient.transactionLabel.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              transactionId: 'tx-consolidation-record',
              labelId: 'label-1',
            }),
          ]),
          skipDuplicates: true,
        }),
      );
    });

    it('should skip unresolved inputs while storing IO and allow sent transactions with null fee', async () => {
      const txid = 'store_io_unresolved_inputs'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      const prevBatchTxid = 'prev_batch'.padEnd(64, 'b');
      const prevFetchNullTxid = 'prev_fetch_null'.padEnd(64, 'c');
      const prevFetchAddrTxid = 'prev_fetch_addr'.padEnd(64, 'd');
      const prevNoVoutTxid = 'prev_no_vout'.padEnd(64, 'e');

      const tx = {
        txid,
        hex: '01000000...',
        confirmations: 1,
        time: Date.now() / 1000,
        vin: [
          { txid: prevBatchTxid, vout: 0 },
          { txid: prevFetchNullTxid, vout: 0 },
          { txid: prevFetchAddrTxid, vout: 1 },
          { txid: prevNoVoutTxid },
        ],
        vout: [
          {
            value: 0.0009,
            n: 0,
            scriptPubKey: { hex: '0014...', address: externalAddress },
          },
        ],
      };

      mockElectrumClient.getTransactionsBatch
        .mockResolvedValueOnce(new Map([[txid, tx as any]]))
        .mockResolvedValueOnce(new Map([
          [prevBatchTxid, {
            txid: prevBatchTxid,
            vout: [
              {
                value: 0,
                n: 0,
                scriptPubKey: { hex: '0014...', addresses: [walletAddress] },
              },
            ],
          } as any],
        ]));

      mockElectrumClient.getTransaction.mockImplementation(async (requestedTxid: string) => {
        if (requestedTxid === prevFetchNullTxid) return null;
        if (requestedTxid === prevFetchAddrTxid) {
          return {
            txid: prevFetchAddrTxid,
            vout: [
              { n: 0, value: 0, scriptPubKey: { hex: '0014...', address: 'tb1q_unused' } },
              { n: 1, scriptPubKey: { hex: '0014...', addresses: [walletAddress] } },
            ],
          } as any;
        }
        return null;
      });

      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-store-branch', txid, type: 'sent' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-store-branch', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'sent',
              fee: null,
            }),
          ]),
        }),
      );

      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(prevFetchNullTxid);
      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(prevFetchAddrTxid);

      const inputRows = mockPrismaClient.transactionInput.createMany.mock.calls.at(-1)?.[0]?.data || [];
      expect(inputRows.some((row: any) => row.txid === prevBatchTxid)).toBe(true);
      expect(inputRows.some((row: any) => row.txid === prevFetchAddrTxid)).toBe(true);
      expect(inputRows.some((row: any) => row.txid === prevFetchNullTxid)).toBe(false);
      expect(inputRows.some((row: any) => row.txid === prevNoVoutTxid)).toBe(false);
    });

    it('should keep unknown output type for unexpected tx record type and skip null-address labels', async () => {
      const txid = 'unknown_type_null_label_addr'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      const walletAddressId = 'addr-label-source';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.0012, address: externalAddress }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));

      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'tx-unknown-type', txid, type: 'mystery' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) {
          return [{ id: 'tx-unknown-type', txid, addressId: null }];
        }
        return [];
      });
      mockPrismaClient.addressLabel.findMany.mockResolvedValue([
        { addressId: walletAddressId, labelId: 'label-1' },
      ] as any);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: walletAddressId, address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      const outputRows = mockPrismaClient.transactionOutput.createMany.mock.calls.at(-1)?.[0]?.data || [];
      const walletOutput = outputRows.find((row: any) => row.address === walletAddress);
      expect(walletOutput?.outputType).toBe('unknown');
      expect(mockPrismaClient.transactionLabel.createMany).not.toHaveBeenCalled();
    });

    it('should deduplicate duplicate txid:type entries before insert', async () => {
      const txid = 'duplicate_txid_type'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      })]]));

      // Force classification branch guards to treat each history item as unseen so duplicate rows are produced.
      const nonDedupingMap = new Map<string, boolean>();
      vi.spyOn(nonDedupingMap, 'has').mockReturnValue(false);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [
          { tx_hash: txid, height: 800000 },
          { tx_hash: txid, height: 800000 },
        ]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-dedupe', address: walletAddress } as any]]),
        existingTxMap: nonDedupingMap as any,
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      const createArgs = mockPrismaClient.transaction.createMany.mock.calls.at(-1)?.[0];
      expect(createArgs).toBeDefined();
      expect(createArgs.data).toHaveLength(1);
      expect(createArgs.data[0]).toEqual(expect.objectContaining({ txid, type: 'received' }));
    });

    it('should avoid per-input fallback fetch when cached prev tx exists without requested vout', async () => {
      const txid = 'cached_prev_no_vout'.padEnd(64, 'a');
      const prevTxid = 'cached_prev_txid'.padEnd(64, 'b');
      const walletAddress = 'tb1q_wallet_addr';

      const tx = {
        txid,
        hex: '01000000...',
        confirmations: 100,
        time: Date.now() / 1000,
        vin: [{ txid: prevTxid, vout: 1 }],
        vout: [{ value: 0.0009, n: 0, scriptPubKey: { hex: '0014...', address: walletAddress } }],
      };

      let batchCalls = 0;
      mockElectrumClient.getTransactionsBatch.mockImplementation(async () => {
        batchCalls += 1;
        if (batchCalls === 1) {
          return new Map([[txid, tx as any]]);
        }
        return new Map([[prevTxid, { txid: prevTxid, vout: [] }]]);
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-prev-no-vout', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockElectrumClient.getTransactionsBatch).toHaveBeenCalledTimes(2);
      expect(mockElectrumClient.getTransaction).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalled();
    });

    it('should handle mixed store IO edge paths for missing tx details and absent vin/vout arrays', async () => {
      const txid = 'store_io_edge_paths'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      const missingCacheTxid = 'missing_cache_txid'.padEnd(64, 'b');
      const noIoTxid = 'no_io_arrays_txid'.padEnd(64, 'c');
      const prevTxid = 'prev_no_value'.padEnd(64, 'd');

      const tx = {
        txid,
        hex: '01000000...',
        confirmations: 50,
        time: Date.now() / 1000,
        vin: [
          { coinbase: 'coinbase' },
          {
            txid: prevTxid,
            vout: 0,
            prevout: {
              scriptPubKey: { hex: '0014...', address: walletAddress },
              // value intentionally omitted -> input amount remains 0
            },
          },
        ],
        vout: [{ value: 0.0008, n: 0, scriptPubKey: { hex: '0014...', address: externalAddress } }],
      };

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, tx as any]]));
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') return [];
        if (args?.select?.txid && !args?.select?.id) return [];
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [
            { id: 'tx-main-edge', txid, type: 'sent' },
            { id: 'tx-no-io-edge', txid: noIoTxid, type: 'sent' },
            { id: 'tx-missing-edge', txid: missingCacheTxid, type: 'sent' },
          ];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) return [];
        return [];
      });

      const txDetailsCache = new Map<string, any>([
        [noIoTxid, { txid: noIoTxid }], // no vin/vout -> defaults to []
      ]) as any;

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-store-io-edge', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      const createdInputs = mockPrismaClient.transactionInput.createMany.mock.calls.at(-1)?.[0]?.data || [];
      expect(createdInputs).toHaveLength(1);
      expect(createdInputs[0]).toEqual(expect.objectContaining({
        transactionId: 'tx-main-edge',
        txid: prevTxid,
        amount: BigInt(0),
      }));
    });
  });
});
