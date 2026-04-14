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

export function registerProcessTransactionLabelsDedupeEdgeTests(walletId: string): void {
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
}
