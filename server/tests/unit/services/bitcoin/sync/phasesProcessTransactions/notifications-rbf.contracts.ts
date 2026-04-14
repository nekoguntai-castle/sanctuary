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

export function registerProcessTransactionNotificationsRbfTests(walletId: string): void {
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
}
