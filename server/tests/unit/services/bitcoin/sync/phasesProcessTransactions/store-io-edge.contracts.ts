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

export function registerProcessTransactionStoreIoEdgeTests(walletId: string): void {
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
}
