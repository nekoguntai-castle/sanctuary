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
  checkExistingPhase,
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

export function registerProcessTransactionStoreIoPrimaryTests(walletId: string): void {
    it('should reconcile an existing txid without duplicate creation side effects', async () => {
      const txid = 'existing_txid'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';

      const transaction = createMockTransaction({
        txid,
        inputs: [
          { txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' },
          { txid: 'unresolved'.padEnd(64, 'c'), vout: 0, value: 0.001, address: 'unknown' },
        ],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });
      transaction.vin[1].prevout = undefined;
      mockElectrumClient.getTransactionsBatch
        .mockResolvedValueOnce(new Map([[txid, transaction]]))
        .mockResolvedValueOnce(new Map());
      mockElectrumClient.getTransaction.mockResolvedValue(undefined);
      mockPrismaClient.transaction.findMany.mockResolvedValue([{ txid }]);
      mockPrismaClient.transaction.createManyAndReturn.mockResolvedValue([]);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-existing', address: walletAddress } as any]]),
        existingTxMap: new Map([[`${txid}:received`, true]]),
        existingTxidSet: new Set([txid]),
        classificationRepairTxids: new Set([txid]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await processTransactionsPhase(ctx);
      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalled();
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.transaction.updateMany).not.toHaveBeenCalled();
      expect(result.stats.newTransactionsCreated).toBe(0);
      expect(notifyNewTransactions).not.toHaveBeenCalled();
      expect(recalculateWalletBalances).not.toHaveBeenCalled();
      expect(mockPrismaClient.transactionLabel.createMany).not.toHaveBeenCalled();
    });

    it('advances a selected repair before failed raw fetches so the backlog cannot starve', async () => {
      const txid = 'failed_repair_fetch'.padEnd(64, 'f');
      mockElectrumClient.getTransactionsBatch.mockRejectedValue(new Error('batch unavailable'));
      mockElectrumClient.getTransaction.mockRejectedValue(new Error('raw tx unavailable'));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        existingTxidSet: new Set([txid]),
        classificationRepairTxids: new Set([txid]),
        historyResults: new Map(),
      });

      const result = await processTransactionsPhase(ctx);

      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.transaction.createManyAndReturn).not.toHaveBeenCalled();
      expect(notifyNewTransactions).not.toHaveBeenCalled();
      expect(recalculateWalletBalances).not.toHaveBeenCalled();
      expect(result.stats.newTransactionsCreated).toBe(0);
    });

    it('advances only the selected sent I/O repair before a failed raw fetch', async () => {
      const txid = 'failed_sent_io_fetch'.padEnd(64, 'f');
      mockElectrumClient.getTransactionsBatch.mockRejectedValue(new Error('batch unavailable'));
      mockElectrumClient.getTransaction.mockRejectedValue(new Error('raw tx unavailable'));
      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        existingTxidSet: new Set([txid]),
        ioRepairTxids: new Set([txid]),
        historyResults: new Map(),
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);
      const statement = mockPrismaClient.$executeRaw.mock.calls[0][0] as { strings: string[] };
      expect(statement.strings.join('')).toContain('"ioLastAttemptAt"');
      expect(statement.strings.join('')).not.toContain('"classificationLastAttemptAt"');
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
      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalled();
      expect(notifyNewTransactions).toHaveBeenCalled();

      mockPrismaClient.transaction.findMany.mockResolvedValueOnce([{
        txid,
        type: 'sent',
        classificationInputsComplete: true,
        classificationLastAttemptAt: null,
        ioComplete: false,
        ioLastAttemptAt: null,
      }]);
      const nextSync = await checkExistingPhase(createTestContext({
        walletId,
        allTxids: new Set([txid]),
      }));
      expect(nextSync.ioRepairTxids.has(txid)).toBe(true);
      expect(nextSync.newTxids).toContain(txid);
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
      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
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
}
