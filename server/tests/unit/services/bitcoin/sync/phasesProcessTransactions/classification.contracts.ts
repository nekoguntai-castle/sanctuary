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

export function registerProcessTransactionClassificationTests(walletId: string): void {
    it('should return early when no new txids to process', async () => {
      const ctx = createTestContext({
        walletId,
        newTxids: [],
        historyResults: new Map(),
      });

      const result = await processTransactionsPhase(ctx);

      expect(result.stats.newTransactionsCreated).toBe(0);
      expect(mockPrismaClient.transaction.createManyAndReturn).not.toHaveBeenCalled();
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

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'received',
              amount: BigInt(99000), // 0.00099 BTC in sats
              classificationInputsComplete: true,
            }),
          ]),
        })
      );
    });

    it('marks a partial multi-input classification incomplete until every input resolves', async () => {
      const txid = 'partial_multi_input'.padEnd(64, 'a');
      const walletAddress = 'tb1q_partial_wallet';
      const externalAddress = 'tb1q_partial_external';
      const transaction = createMockTransaction({
        txid,
        inputs: [
          { txid: 'resolved_prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress },
          { txid: 'missing_prev'.padEnd(64, 'c'), vout: 0, value: 0.002, address: walletAddress },
        ],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });
      transaction.vin[1].prevout = undefined;
      mockElectrumClient.getTransactionsBatch
        .mockResolvedValueOnce(new Map([[txid, transaction]]))
        .mockResolvedValueOnce(new Map());
      mockElectrumClient.getTransaction.mockResolvedValue(undefined);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-partial', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'received',
            classificationInputsComplete: false,
          })],
        })
      );
    });

    it('marks the later classification complete once every raw input resolves', async () => {
      const txid = 'complete_multi_input'.padEnd(64, 'a');
      const walletAddress = 'tb1q_complete_wallet';
      const externalAddress = 'tb1q_complete_external';
      const transaction = createMockTransaction({
        txid,
        inputs: [
          { txid: 'external_prev'.padEnd(64, 'b'), vout: 0, value: 0.002, address: externalAddress },
          { txid: 'wallet_prev'.padEnd(64, 'c'), vout: 0, value: 0.001, address: walletAddress },
        ],
        outputs: [
          { value: 0.0015, address: externalAddress },
          { value: 0.0014, address: walletAddress },
        ],
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-complete', address: walletAddress } as any]]),
        existingTxMap: new Map([[`${txid}:received`, true]]),
        existingTxidSet: new Set([txid]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'sent',
            classificationInputsComplete: true,
          })],
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

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
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

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
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

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
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

    it('promotes a transient received row without duplicate creation side effects', async () => {
      const txid = 'repair_received_to_sent'.padEnd(64, 'a');
      const walletAddress = 'tb1q_repair_wallet';
      const externalAddress = 'tb1q_repair_recipient';
      const transaction = createMockTransaction({
        txid,
        inputs: [{
          txid: 'repair_prev'.padEnd(64, 'b'),
          vout: 0,
          value: 0.001,
          address: walletAddress,
        }],
        outputs: [
          { value: 0.0008, address: externalAddress },
          { value: 0.0001, address: walletAddress },
        ],
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));
      mockPrismaClient.transaction.createManyAndReturn.mockResolvedValue([]);
      mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaClient.addressLabel.findMany.mockResolvedValue([
        { addressId: 'addr-repair', labelId: 'label-repair' },
      ]);
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'repair-row-id', txid, type: 'sent' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) {
          return [{ id: 'repair-row-id', txid, addressId: 'addr-repair' }];
        }
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-repair', address: walletAddress } as any]]),
        existingTxMap: new Map([[`${txid}:received`, true]]),
        existingTxidSet: new Set([txid]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.updateMany).toHaveBeenCalledWith({
        where: {
          txid,
          walletId,
          type: { in: ['received', 'consolidation'] },
        },
        data: expect.objectContaining({ type: 'sent', rbfStatus: 'confirmed' }),
      });
      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalled();
      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalled();
      expect(mockPrismaClient.transactionLabel.createMany).toHaveBeenCalledWith({
        data: [{ transactionId: 'repair-row-id', labelId: 'label-repair' }],
        skipDuplicates: true,
      });
      expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
      expect(notifyNewTransactions).not.toHaveBeenCalled();
      expect(result.newTransactions).toEqual([]);
      expect(result.stats.newTransactionsCreated).toBe(0);
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

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
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

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
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
}
