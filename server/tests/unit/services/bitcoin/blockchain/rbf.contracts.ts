import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  createMockTransaction,
  createMockUTXO,
  createMockAddressHistory,
} from '../../../../mocks/electrum';
import { sampleUtxos, sampleWallets, testnetAddresses } from '../../../../fixtures/bitcoin';
import { validateAddress } from '../../../../../src/services/bitcoin/utils';
import * as addressDerivation from '../../../../../src/services/bitcoin/addressDerivation';
import * as syncModule from '../../../../../src/services/bitcoin/sync';
import { getBlockchainService } from './blockchainTestHarness';

export function registerBlockchainRbfTests(): void {
  describe('RBF Sync Detection', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      resetPrismaMocks();
    });

    describe('RBF Cleanup at sync start', () => {
      it('should mark pending transaction as replaced when confirmed tx shares same input', async () => {
        const pendingTxid = 'pending_' + 'a'.repeat(56);
        const confirmedTxid = 'confirmed_' + 'b'.repeat(53);
        const sharedInputTxid = 'input_' + 'c'.repeat(58);
        const sharedInputVout = 0;

        // Setup wallet mock
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          network: 'testnet',
          descriptor: 'wpkh(tpubXXX)',
        });

        // Mock addresses
        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: 'tb1test', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: false },
        ]);

        // Mock pending transactions with inputs (for RBF cleanup)
        mockPrismaClient.transaction.findMany.mockImplementation(async (args) => {
          // First call: pending txs for RBF cleanup
          if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
            return [{
              id: 'pending-tx-id',
              txid: pendingTxid,
              inputs: [{ txid: sharedInputTxid, vout: sharedInputVout }],
            }];
          }
          // Batch query: confirmed txs sharing inputs with pending txs
          if (args?.where?.confirmations?.gt === 0 && args?.where?.inputs?.some?.OR) {
            return [{
              txid: confirmedTxid,
              inputs: [{ txid: sharedInputTxid, vout: sharedInputVout }],
            }];
          }
          // Call for unlinked replaced txs
          if (args?.where?.rbfStatus === 'replaced' && args?.where?.replacedByTxid === null) {
            return [];
          }
          return [];
        });

        // Track update calls
        const updateCalls: any[] = [];
        mockPrismaClient.transaction.update.mockImplementation(async (args) => {
          updateCalls.push(args);
          return { id: 'pending-tx-id', txid: pendingTxid, rbfStatus: 'replaced' };
        });

        // Mock empty address history (no new transactions to process)
        mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map());

        // Run sync
        await getBlockchainService().syncWallet(walletId);

        // Verify the pending transaction was marked as replaced
        const rbfUpdateCall = updateCalls.find(
          call => call.data?.rbfStatus === 'replaced' && call.data?.replacedByTxid === confirmedTxid
        );
        expect(rbfUpdateCall).toBeDefined();
        expect(rbfUpdateCall?.where?.id).toBe('pending-tx-id');
      });

      it('should not mark pending transaction if no confirmed tx shares input', async () => {
        const pendingTxid = 'pending_' + 'a'.repeat(56);

        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          network: 'testnet',
          descriptor: 'wpkh(tpubXXX)',
        });

        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: 'tb1test', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: false },
        ]);

        // Pending transaction with inputs
        mockPrismaClient.transaction.findMany.mockImplementation(async (args) => {
          if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
            return [{
              id: 'pending-tx-id',
              txid: pendingTxid,
              inputs: [{ txid: 'input_txid', vout: 0 }],
            }];
          }
          // Batch query: no confirmed txs share inputs
          if (args?.where?.confirmations?.gt === 0 && args?.where?.inputs?.some?.OR) {
            return [];
          }
          if (args?.where?.rbfStatus === 'replaced') {
            return [];
          }
          return [];
        });

        const updateCalls: any[] = [];
        mockPrismaClient.transaction.update.mockImplementation(async (args) => {
          updateCalls.push(args);
          return args;
        });

        mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map());

        await getBlockchainService().syncWallet(walletId);

        // Should not have updated the pending transaction with rbfStatus
        const rbfUpdateCall = updateCalls.find(call => call.data?.rbfStatus === 'replaced');
        expect(rbfUpdateCall).toBeUndefined();
      });
    });

    describe('Retroactive RBF linking', () => {
      it('should link replaced transactions that have no replacedByTxid', async () => {
        const replacedTxid = 'replaced_' + 'a'.repeat(55);
        const replacementTxid = 'replacement_' + 'b'.repeat(52);
        const sharedInputTxid = 'input_' + 'c'.repeat(58);

        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          network: 'testnet',
          descriptor: 'wpkh(tpubXXX)',
        });

        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: 'tb1test', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: false },
        ]);

        mockPrismaClient.transaction.findMany.mockImplementation(async (args) => {
          // First call: pending txs for RBF cleanup
          if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
            return [];
          }
          // Second call: unlinked replaced txs (retroactive linking)
          if (args?.where?.rbfStatus === 'replaced' && args?.where?.replacedByTxid === null) {
            return [{
              id: 'unlinked-tx-id',
              txid: replacedTxid,
              inputs: [{ txid: sharedInputTxid, vout: 0 }],
            }];
          }
          // Batch query: confirmed txs sharing inputs with unlinked txs
          if (args?.where?.confirmations?.gt === 0 && args?.where?.inputs?.some?.OR) {
            return [{
              txid: replacementTxid,
              inputs: [{ txid: sharedInputTxid, vout: 0 }],
            }];
          }
          return [];
        });

        const updateCalls: any[] = [];
        mockPrismaClient.transaction.update.mockImplementation(async (args) => {
          updateCalls.push(args);
          return args;
        });

        mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map());

        await getBlockchainService().syncWallet(walletId);

        // Verify retroactive linking occurred
        const linkUpdateCall = updateCalls.find(
          call => call.where?.id === 'unlinked-tx-id' && call.data?.replacedByTxid === replacementTxid
        );
        expect(linkUpdateCall).toBeDefined();
      });

      it('should skip replaced transactions with no inputs', async () => {
        const replacedTxid = 'replaced_' + 'a'.repeat(55);

        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          network: 'testnet',
          descriptor: 'wpkh(tpubXXX)',
        });

        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: 'tb1test', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: false },
        ]);

        mockPrismaClient.transaction.findMany.mockImplementation(async (args) => {
          if (args?.where?.confirmations === 0) {
            return [];
          }
          if (args?.where?.rbfStatus === 'replaced') {
            // Replaced transaction with no inputs - can't link
            return [{
              id: 'unlinked-tx-id',
              txid: replacedTxid,
              inputs: [],
            }];
          }
          return [];
        });

        const updateCalls: any[] = [];
        mockPrismaClient.transaction.update.mockImplementation(async (args) => {
          updateCalls.push(args);
          return args;
        });

        mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map());

        await getBlockchainService().syncWallet(walletId);

        // Should not update transaction without inputs
        const linkUpdateCall = updateCalls.find(
          call => call.where?.id === 'unlinked-tx-id' && call.data?.replacedByTxid
        );
        expect(linkUpdateCall).toBeUndefined();
      });
    });

    /**
     * Note on inline RBF detection coverage:
     *
     * The inline RBF detection (lines 1178-1251 in blockchain.ts) runs when new confirmed
     * transactions are synced and links them to existing pending transactions with matching inputs.
     *
     * This path is functionally equivalent to the "RBF Cleanup at sync start" tests above -
     * both detect RBF replacements by finding transactions that share the same inputs.
     * The cleanup serves as a fallback that catches any replacements the inline detection misses.
     *
     * Full integration testing of the inline path requires complex mocking of the entire sync
     * flow (electrum batch APIs, transaction creation, input/output storage) which causes
     * memory issues in the test environment. The core logic (input matching + status updates)
     * is well-covered by the cleanup tests.
     */
  });
}
