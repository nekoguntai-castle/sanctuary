import { expect, it, vi, type Mock } from 'vitest';
import './processTransactionsTestHarness';
import { mockPrismaClient } from '../../../../../mocks/prisma';
import {
  mockElectrumClient,
  createMockTransaction,
  createMockUTXO,
} from '../../../../../mocks/electrum';
import {
  createTestContext,
  processTransactionsPhase,
  type SyncContext,
} from '../../../../../../src/services/bitcoin/sync';
import {
  correctMisclassifiedConsolidations,
  recalculateWalletBalances,
} from '../../../../../../src/services/bitcoin/utils/balanceCalculation';
import { getBlockTimestamp } from '../../../../../../src/services/bitcoin/utils/blockHeight';
import { getNotificationService, walletLog } from '../../../../../../src/websocket/notifications';
import { notifyNewTransactions } from '../../../../../../src/services/notifications/notificationService';

export function registerProcessTransactionBatchIoTests(walletId: string): void {
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
}
