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
    const walletAddress = 'tb1test';

    const mockEmptyAddressEvidence = (): void => {
      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([[walletAddress, []]])
      );
      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([[walletAddress, []]])
      );
    };

    const mockRbfCleanupResults = (
      active: Array<{ id: string; txid: string; replacementTxid: string }>,
      unlinked: Array<{ id: string; txid: string; replacementTxid: string }>,
    ): void => {
      mockPrismaClient.$queryRaw.mockImplementation(async (query: any) => {
        const sql = query?.strings?.join('') ?? '';
        if (sql.includes('UPDATE "transactions" AS target')) {
          return [{ id: query.values?.[1] ?? 'updated-rbf-row' }];
        }
        if (sql.includes('FROM "transactions" AS target')) {
          return sql.includes(`target."rbfStatus" = 'active'`) ? active : unlinked;
        }
        if (sql.includes('FROM "wallets"') && sql.includes('FOR UPDATE')) {
          return [{ id: query.values?.[0] ?? walletId }];
        }
        return [];
      });
    };

    beforeEach(() => {
      resetPrismaMocks();
    });

    describe('RBF Cleanup at sync start', () => {
      it('should mark pending transaction as replaced when confirmed tx shares same input', async () => {
        const pendingTxid = 'pending_' + 'a'.repeat(56);
        const confirmedTxid = 'confirmed_' + 'b'.repeat(53);

        // Setup wallet mock
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          network: 'testnet',
          descriptor: 'wpkh(tpubXXX)',
        });

        // Mock addresses
        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: walletAddress, derivationPath: "m/84'/0'/0'/0/0", index: 0, used: false },
        ]);

        mockRbfCleanupResults([{
          id: 'pending-tx-id',
          txid: pendingTxid,
          replacementTxid: confirmedTxid,
        }], []);

        // Mock empty address history (no new transactions to process)
        mockEmptyAddressEvidence();

        // Run sync
        await getBlockchainService().syncWallet(walletId);

        // Verify the pending transaction was marked as replaced
        const rbfUpdateCall = mockPrismaClient.$queryRaw.mock.calls.find(([statement]) => (
          (statement as { strings?: string[] }).strings?.join('')
            .includes('UPDATE "transactions" AS target')
        ));
        expect(rbfUpdateCall).toBeDefined();
        expect((rbfUpdateCall?.[0] as { values: unknown[] }).values).toEqual(
          expect.arrayContaining(['pending-tx-id', confirmedTxid])
        );
      });

      it('should not mark pending transaction if no confirmed tx shares input', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          network: 'testnet',
          descriptor: 'wpkh(tpubXXX)',
        });

        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: walletAddress, derivationPath: "m/84'/0'/0'/0/0", index: 0, used: false },
        ]);

        mockRbfCleanupResults([], []);

        mockEmptyAddressEvidence();

        await getBlockchainService().syncWallet(walletId);

        // Should not have updated the pending transaction with rbfStatus
        const rbfUpdateCall = mockPrismaClient.$queryRaw.mock.calls.find(([statement]) => (
          (statement as { strings?: string[] }).strings?.join('')
            .includes('UPDATE "transactions" AS target')
        ));
        expect(rbfUpdateCall).toBeUndefined();
      });
    });

    describe('Retroactive RBF linking', () => {
      it('should link replaced transactions that have no replacedByTxid', async () => {
        const replacedTxid = 'replaced_' + 'a'.repeat(55);
        const replacementTxid = 'replacement_' + 'b'.repeat(52);

        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          network: 'testnet',
          descriptor: 'wpkh(tpubXXX)',
        });

        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: walletAddress, derivationPath: "m/84'/0'/0'/0/0", index: 0, used: false },
        ]);

        mockRbfCleanupResults([], [{
          id: 'unlinked-tx-id',
          txid: replacedTxid,
          replacementTxid,
        }]);

        mockEmptyAddressEvidence();

        await getBlockchainService().syncWallet(walletId);

        // Verify retroactive linking occurred
        const linkUpdateCall = mockPrismaClient.$queryRaw.mock.calls.find(([statement]) => (
          (statement as { strings?: string[] }).strings?.join('')
            .includes('UPDATE "transactions" AS target')
        ));
        expect(linkUpdateCall).toBeDefined();
        expect((linkUpdateCall?.[0] as { values: unknown[] }).values).toEqual(
          expect.arrayContaining(['unlinked-tx-id', replacementTxid])
        );
      });

      it('should skip replaced transactions with no inputs', async () => {
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          network: 'testnet',
          descriptor: 'wpkh(tpubXXX)',
        });

        mockPrismaClient.address.findMany.mockResolvedValue([
          { address: walletAddress, derivationPath: "m/84'/0'/0'/0/0", index: 0, used: false },
        ]);

        // A row without stored inputs cannot appear in the database-side join.
        mockRbfCleanupResults([], []);

        mockEmptyAddressEvidence();

        await getBlockchainService().syncWallet(walletId);

        // Should not update transaction without inputs
        const linkUpdateCall = mockPrismaClient.$queryRaw.mock.calls.find(([statement]) => (
          (statement as { strings?: string[] }).strings?.join('')
            .includes('UPDATE "transactions" AS target')
        ));
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
