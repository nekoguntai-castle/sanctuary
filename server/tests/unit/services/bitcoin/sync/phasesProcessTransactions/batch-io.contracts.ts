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
import { fetchAuthenticatedTransactions } from '../../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import {
  correctMisclassifiedConsolidations,
  recalculateWalletBalances,
} from '../../../../../../src/services/bitcoin/utils/balanceCalculation';
import { getBlockTimestamp } from '../../../../../../src/services/bitcoin/utils/blockHeight';
import { getNotificationService, walletLog } from '../../../../../../src/websocket/notifications';
import { notifyNewTransactions } from '../../../../../../src/services/notifications/notificationService';

export function registerProcessTransactionBatchIoTests(walletId: string): void {
    it('propagates a non-budget candidate failure without persisting the batch', async () => {
      const txid = 'candidate_transport_failure'.padEnd(64, 'f');
      const failure = new Error('candidate transport failed');
      vi.mocked(fetchAuthenticatedTransactions).mockRejectedValueOnce(failure);
      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map(),
        txDetailsCache: new Map() as any,
      });

      await expect(processTransactionsPhase(ctx)).rejects.toBe(failure);

      expect(mockPrismaClient.transaction.createManyAndReturn).not.toHaveBeenCalled();
      expect(mockElectrumClient.getTransaction).not.toHaveBeenCalled();
    });

    it('persists locally complete siblings when the candidate budget expires', async () => {
      const walletAddress = 'tb1q_budget_wallet';
      const externalAddress = 'tb1q_budget_external';
      const localTxid = 'budget_local'.padEnd(64, 'a');
      const headerTxid = 'budget_header'.padEnd(64, 'b');
      const parentTxid = 'budget_parent'.padEnd(64, 'c');
      const missingParentTxid = 'missing_parent'.padEnd(64, 'd');
      const inlineInput = {
        txid: 'inline_parent'.padEnd(64, 'e'),
        vout: 0,
        prevout: {
          value: 0.001,
          scriptPubKey: { address: externalAddress },
        },
      };
      const output = {
        value: 0.0009,
        n: 0,
        scriptPubKey: { address: walletAddress },
      };
      const transactions = new Map<string, any>([
        [localTxid, {
          txid: localTxid,
          hex: 'local',
          time: 1_700_000_000,
          vin: [inlineInput],
          vout: [output],
        }],
        [headerTxid, {
          txid: headerTxid,
          hex: 'header',
          vin: [inlineInput],
          vout: [output],
        }],
        [parentTxid, {
          txid: parentTxid,
          hex: 'parent',
          time: 1_700_000_000,
          vin: [{ txid: missingParentTxid, vout: 0 }],
          vout: [output],
        }],
      ]);
      vi.mocked(fetchAuthenticatedTransactions).mockImplementationOnce(async (ctx, txids) => {
        for (const txid of txids) ctx.txDetailsCache.set(txid, transactions.get(txid));
        return new Set(txids);
      });
      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [localTxid, headerTxid, parentTxid],
        historyResults: new Map([[walletAddress, [
          { tx_hash: localTxid, height: 800000 },
          { tx_hash: headerTxid, height: 800000 },
          { tx_hash: parentTxid, height: 800000 },
        ]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-budget', address: walletAddress } as any]]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
        attemptRuntime: {
          signal: new AbortController().signal,
          deadlineAt: Date.now(),
        },
      });

      const result = await processTransactionsPhase(ctx);

      expect(fetchAuthenticatedTransactions).toHaveBeenCalledTimes(3);
      expect(mockElectrumClient.getTransactionsBatch).toHaveBeenCalledTimes(2);
      expect(mockElectrumClient.getTransaction).not.toHaveBeenCalled();
      expect(getBlockTimestamp).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ txid: localTxid, type: 'received' })],
        }),
      );
      expect(result.newTransactions.map(transaction => transaction.txid)).toEqual([localTxid]);
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
        attemptRuntime: {
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 5_000,
        },
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
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
      const createManyCall = mockPrismaClient.transaction.createManyAndReturn.mock.calls[0][0];
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
      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
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

      expect(storeIOCalled).toBe(true);
      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
      const lockStatement = mockPrismaClient.$queryRaw.mock.calls.find(call =>
        (call[0] as { strings?: string[] }).strings?.join('').includes('address-sync-io-lock')
      );
      expect(lockStatement).toBeDefined();

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
          {
            txid: prevTxid1,
            vout: 0,
            prevout: { value: 0.001, scriptPubKey: { hex: '0014-addressless' } },
          },
          { txid: prevTxid2, vout: 1 }, // No prevout - needs lookup
        ],
        vout: [
          {
            value: 0.008,
            n: 0,
            scriptPubKey: { hex: '0014...', address: 'external-recipient' },
          },
          {
            value: 0.001,
            n: 1,
            scriptPubKey: { hex: '0014...', address: walletAddress },
          },
        ],
      };

      // Previous transactions to be batch prefetched
      const prevTx1 = {
        txid: prevTxid1,
        hex: '01000000...',
        vout: [{
          value: 0.005,
          n: 0,
          scriptPubKey: { hex: '0014...', address: walletAddress },
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
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.select?.id && args?.where?.txid?.in?.includes(txid)) {
          return [{ id: 'addressless-inline-row', txid, type: 'sent' }];
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

      // Should have made 2 batch calls: one for main TX, one for prev TXs
      expect(batchCalls.length).toBe(2);
      expect(batchCalls[0]).toContain(txid);
      // Second batch should contain both prev txids for batch prefetch
      expect(batchCalls[1]).toContain(prevTxid1);
      expect(batchCalls[1]).toContain(prevTxid2);
      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'sent',
            classificationInputsComplete: true,
            amount: BigInt(-400000),
            fee: BigInt(100000),
          })],
        })
      );
      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            txid: prevTxid1,
            address: walletAddress,
          }),
        ]),
        skipDuplicates: true,
      });

      // Should NOT have made individual getTransaction calls (all prefetched in batch)
      expect(mockElectrumClient.getTransaction).not.toHaveBeenCalled();
    });

    it('creates scalar history and repairs I/O for an OP_RETURN-only spend', async () => {
      const walletAddress = 'tb1q_io_only_wallet';
      const txid = 'io_only_op_return'.padEnd(64, 'a');
      const previousTxid = 'io_only_previous'.padEnd(64, 'b');
      const transaction = {
        txid,
        vin: [{
          txid: previousTxid,
          vout: 0,
          prevout: {
            value: 0.001,
            scriptPubKey: { address: walletAddress },
          },
        }],
        vout: [{
          value: 0,
          scriptPubKey: { hex: '6a01ff' },
        }],
      };
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(
        new Map([[txid, transaction]])
      );
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [{
            id: 'pending-op-return-row',
            txid: 'pending_op_return'.padEnd(64, 'c'),
            inputs: [{ txid: previousTxid, vout: 0 }],
          }];
        }
        if (args?.select?.id && args?.where?.txid?.in?.includes(txid)) {
          return [{ id: 'io-only-row', txid, type: 'sent', confirmations: 1 }];
        }
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, {
          id: 'io-only-address',
          address: walletAddress,
        } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });
      ctx.ioRepairTxids = new Set([txid]);

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'sent',
            amount: BigInt(-100_000),
            fee: BigInt(100_000),
          })],
        })
      );
      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          transactionId: 'io-only-row',
          txid: previousTxid,
          address: walletAddress,
        })],
        skipDuplicates: true,
      });
      const completion = mockPrismaClient.$executeRaw.mock.calls
        .map(([statement]) => statement as { strings: string[] })
        .find(statement => statement.strings.join('').includes('SET "ioComplete" = true'));
      expect(completion).toBeDefined();
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalledWith({
        where: { id: 'pending-op-return-row' },
        data: expect.objectContaining({ rbfStatus: 'replaced' }),
      });
    });

    it('completes classification-null I/O repair when no input rows exist', async () => {
      const walletAddress = 'tb1q_io_only_coinbase';
      const txid = 'io_only_coinbase_op_return'.padEnd(64, 'a');
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(
        new Map([[txid, {
          txid,
          vin: [{ coinbase: '03abcdef' }],
          vout: [{ value: 0, scriptPubKey: { hex: '6a01ff' } }],
        }]])
      );
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.select?.id && args?.where?.txid?.in?.includes(txid)) {
          return [{ id: 'io-only-coinbase-row', txid, type: 'received', confirmations: 1 }];
        }
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, {
          id: 'io-only-coinbase-address',
          address: walletAddress,
        } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });
      ctx.ioRepairTxids = new Set([txid]);

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).not.toHaveBeenCalled();
      expect(mockPrismaClient.transactionInput.createMany).not.toHaveBeenCalled();
      const completion = mockPrismaClient.$executeRaw.mock.calls
        .map(([statement]) => statement as { strings: string[] })
        .find(statement => statement.strings.join('').includes('SET "ioComplete" = true'));
      expect(completion).toBeDefined();
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('keeps sync alive when classification-null I/O repair persistence fails', async () => {
      const walletAddress = 'tb1q_io_repair_failure';
      const txid = 'io_repair_failure'.padEnd(64, 'a');
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
        txid,
        vin: [{
          txid: 'failed_repair_prev'.padEnd(64, 'b'),
          vout: 0,
          prevout: { value: 0.001, scriptPubKey: { address: walletAddress } },
        }],
        vout: [{ value: 0, scriptPubKey: { hex: '6a' } }],
      }]]));
      mockPrismaClient.transaction.findMany.mockRejectedValue(
        new Error('I/O repair persistence unavailable')
      );
      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, {
          id: 'failed-io-repair-address',
          address: walletAddress,
        } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });
      ctx.ioRepairTxids = new Set([txid]);

      await expect(processTransactionsPhase(ctx)).resolves.toBe(ctx);
      expect(mockPrismaClient.transactionInput.createMany).not.toHaveBeenCalled();
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
        attemptRuntime: {
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 5_000,
        },
      });

      const result = await processTransactionsPhase(ctx);

      // Should have processed all transactions across multiple batches
      expect(result.stats.transactionsProcessed).toBe(txCount);

      // The selection page remains 25, while full evidence is materialized one
      // current transaction at a time through all 55 candidate lifecycles.
      expect(mockElectrumClient.getTransactionsBatch).toHaveBeenCalledTimes(txCount);
    });

    it('keeps the 25-candidate selection page but materializes and persists one at a time', async () => {
      const walletAddress = 'tb1q_atomic_persistence_wallet';
      const txids = [
        'atomic_persistence_1'.padEnd(64, 'a'),
        'atomic_persistence_2'.padEnd(64, 'b'),
      ];
      const transactions = new Map(txids.map((txid, index) => [txid, {
        txid,
        time: 1_700_000_000,
        vin: [{
          txid: `atomic_parent_${index}`.padEnd(64, 'c'),
          vout: 0,
          prevout: {
            value: 0.001,
            scriptPubKey: { address: 'tb1q_atomic_external' },
          },
        }],
        vout: [{ value: 0.0009, scriptPubKey: { address: walletAddress } }],
      }]));
      mockElectrumClient.getTransactionsBatch.mockImplementation(async (batch: string[]) => (
        new Map(batch.flatMap(txid => {
          const transaction = transactions.get(txid);
          return transaction ? [[txid, transaction] as const] : [];
        }))
      ));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: txids,
        historyResults: new Map([[walletAddress, txids.map(tx_hash => ({
          tx_hash,
          height: 800000,
        }))]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, {
          id: 'atomic-persistence-address',
          address: walletAddress,
        } as any]]),
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockElectrumClient.getTransactionsBatch).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.transaction.createManyAndReturn.mock.calls.map(
        ([args]) => args.data.map((transaction: { txid: string }) => transaction.txid),
      )).toEqual([[txids[0]], [txids[1]]]);
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
      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(failBatchTxid, false);

      // Should have created transactions for both successful batch and fallback
      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalled();
    });
}
