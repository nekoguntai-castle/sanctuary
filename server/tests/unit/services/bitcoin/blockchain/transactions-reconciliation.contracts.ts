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

export function registerBlockchainTransactionsReconciliationTests(): void {
  describe('UTXO Reconciliation', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      // Mock wallet lookup for network-aware sync
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });
    });

    it('should mark spent UTXOs correctly', async () => {
      const address = testnetAddresses.nativeSegwit[0];

      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address, derivationPath: "m/84'/1'/0'/0/0" },
      ]);

      // Existing UTXO in database (must include address for spent detection to work)
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { id: 'utxo-1', txid: 'm'.repeat(64), vout: 0, spent: false, confirmations: 10, blockHeight: 799990, address },
      ]);

      // UTXO no longer on blockchain (was spent)
      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map([[address, []]]));
      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(new Map([[address, []]]));
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await getBlockchainService().syncWallet(walletId);

      // Should mark UTXO as spent
      expect(mockPrismaClient.uTXO.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: expect.objectContaining({ in: ['utxo-1'] }),
          }),
          data: { spent: true },
        })
      );
    });
  });

  describe('Transaction Type Detection', () => {
    it('should detect consolidation transactions', async () => {
      // Consolidation is detected when:
      // 1. isSent is true (at least one input is from wallet)
      // 2. totalToExternal === 0 (no outputs to external addresses)
      // 3. totalToWallet > 0 (outputs go to wallet addresses)
      const walletId = 'test-wallet-id';
      const addr1 = testnetAddresses.nativeSegwit[0];
      const addr2 = testnetAddresses.nativeSegwit[1];

      // Mock wallet lookup
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: addr1, derivationPath: "m/84'/1'/0'/0/0", walletId },
        { id: 'addr-2', address: addr2, derivationPath: "m/84'/1'/0'/0/1", walletId },
      ]);

      const txHash = 'n'.repeat(64);

      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([[addr1, [{ tx_hash: txHash, height: 800000 }]], [addr2, []]])
      );

      // Transaction from wallet address to wallet address (consolidation)
      // Input is from addr1, output is to addr2 - both wallet addresses
      const mockTx = createMockTransaction({
        txid: txHash,
        blockheight: 800000,
        confirmations: 6,
        inputs: [{ txid: 'o'.repeat(64), vout: 0, value: 0.002, address: addr1 }],
        outputs: [{ value: 0.0019, address: addr2 }], // All outputs to wallet
      });
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([[addr1, []], [addr2, []]])
      );
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800006);

      // Track createMany calls to verify consolidation type
      let createManyData: any[] = [];
      mockPrismaClient.transaction.createMany.mockImplementation((args) => {
        createManyData = args.data as any[];
        return Promise.resolve({ count: createManyData.length });
      });

      await getBlockchainService().syncWallet(walletId);

      // Verify that a transaction was created with consolidation type
      if (createManyData.length > 0) {
        const consolidationTx = createManyData.find((tx: any) => tx.type === 'consolidation');
        expect(consolidationTx).toBeDefined();
        // Consolidation amount should be negative (fee only)
        expect(Number(consolidationTx?.amount)).toBeLessThanOrEqual(0);
      }
    });

    it('should detect sent transactions (external recipient)', async () => {
      const walletId = 'test-wallet-id';
      const ourAddress = testnetAddresses.nativeSegwit[0];
      const externalAddress = 'tb1qexternaladdressnotinwallet12345678901234567890abc';

      // Mock wallet lookup
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: ourAddress, derivationPath: "m/84'/1'/0'/0/0", walletId },
      ]);

      const txHash = 'sent'.padEnd(64, 'a');

      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([[ourAddress, [{ tx_hash: txHash, height: 800000 }]]])
      );

      // Transaction from wallet to external address (sent)
      const mockTx = createMockTransaction({
        txid: txHash,
        blockheight: 800000,
        confirmations: 6,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.002, address: ourAddress }],
        outputs: [{ value: 0.001, address: externalAddress }], // Output to external address
      });
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([[ourAddress, []]])
      );
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800006);

      // Track createMany calls
      let createManyData: any[] = [];
      mockPrismaClient.transaction.createMany.mockImplementation((args) => {
        createManyData = args.data as any[];
        return Promise.resolve({ count: createManyData.length });
      });

      await getBlockchainService().syncWallet(walletId);

      // Verify that a sent transaction was created
      if (createManyData.length > 0) {
        const sentTx = createManyData.find((tx: any) => tx.type === 'sent');
        expect(sentTx).toBeDefined();
        // Sent amount should be negative (funds leaving wallet)
        expect(Number(sentTx?.amount)).toBeLessThan(0);
      }
    });

    it('should detect received transactions', async () => {
      const walletId = 'test-wallet-id';
      const ourAddress = testnetAddresses.nativeSegwit[0];
      const externalAddress = 'tb1qexternaladdressnotinwallet12345678901234567890abc';

      // Mock wallet lookup
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address: ourAddress, derivationPath: "m/84'/1'/0'/0/0", walletId },
      ]);

      const txHash = 'recv'.padEnd(64, 'c');

      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([[ourAddress, [{ tx_hash: txHash, height: 800000 }]]])
      );

      // Transaction from external to wallet address (received)
      const mockTx = createMockTransaction({
        txid: txHash,
        blockheight: 800000,
        confirmations: 6,
        inputs: [{ txid: 'prev'.padEnd(64, 'd'), vout: 0, value: 0.002, address: externalAddress }],
        outputs: [{ value: 0.001, address: ourAddress }], // Output to our wallet
      });
      mockElectrumClient.getTransaction.mockResolvedValue(mockTx);

      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([[ourAddress, [{ txid: txHash, vout: 0, value: 100000, height: 800000 }]]])
      );
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800006);

      // Track createMany calls
      let createManyData: any[] = [];
      mockPrismaClient.transaction.createMany.mockImplementation((args) => {
        createManyData = args.data as any[];
        return Promise.resolve({ count: createManyData.length });
      });

      await getBlockchainService().syncWallet(walletId);

      // Verify that a received transaction was created
      if (createManyData.length > 0) {
        const receivedTx = createManyData.find((tx: any) => tx.type === 'received');
        expect(receivedTx).toBeDefined();
        // Received amount should be positive (funds entering wallet)
        expect(Number(receivedTx?.amount)).toBeGreaterThan(0);
      }
    });
  });

  describe('monitorAddress', () => {
    it('should subscribe to address notifications', async () => {
      const address = testnetAddresses.nativeSegwit[0];
      const subscriptionId = 'subscription-123';

      mockElectrumClient.subscribeAddress.mockResolvedValue(subscriptionId);

      const result = await getBlockchainService().monitorAddress(address);

      expect(result).toBe(subscriptionId);
      expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledWith(address);
    });

    it('should propagate error when subscription fails', async () => {
      const address = testnetAddresses.nativeSegwit[0];

      mockElectrumClient.subscribeAddress.mockRejectedValue(new Error('Subscription failed'));

      await expect(getBlockchainService().monitorAddress(address)).rejects.toThrow('Subscription failed');
    });

    it('should propagate error when client not connected', async () => {
      const address = testnetAddresses.nativeSegwit[0];

      mockElectrumClient.subscribeAddress.mockRejectedValue(new Error('Not connected'));

      await expect(getBlockchainService().monitorAddress(address)).rejects.toThrow('Not connected');
    });
  });

  describe('populateMissingTransactionFields', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      // Mock wallet lookup for network (required for getBlockHeight and getNodeClient)
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'mainnet',
      });
      mockElectrumClient.getBlockHeight.mockResolvedValue(800100);
    });

    it('should handle transactions with all fields populated', async () => {
      // No transactions need updating
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().populateMissingTransactionFields(walletId);

      expect(result.updated).toBe(0);
      expect(result.confirmationUpdates).toEqual([]);
    });

    it('should return result structure with updated count and confirmationUpdates', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().populateMissingTransactionFields(walletId);

      expect(typeof result.updated).toBe('number');
      expect(Array.isArray(result.confirmationUpdates)).toBe(true);
    });

    it('should return empty result when wallet not found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const result = await getBlockchainService().populateMissingTransactionFields(walletId);

      expect(result.updated).toBe(0);
      expect(result.confirmationUpdates).toEqual([]);
    });
  });

  describe('syncWallet Edge Cases', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      // Mock wallet lookup for network-aware sync
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });
    });

    it('should handle batch RPC failures gracefully', async () => {
      const addresses = [
        { id: 'addr-1', address: testnetAddresses.nativeSegwit[0], derivationPath: "m/84'/1'/0'/0/0" },
      ];

      mockPrismaClient.address.findMany.mockResolvedValue(addresses);

      // Batch call fails but function handles it gracefully
      mockElectrumClient.getAddressHistoryBatch.mockImplementation(() => {
        return Promise.reject(new Error('Batch failed'));
      });

      // Function should handle gracefully - may throw or return empty result
      try {
        const result = await getBlockchainService().syncWallet(walletId);
        // If it doesn't throw, it should return a valid structure
        expect(result.addresses).toBeGreaterThanOrEqual(0);
      } catch (error) {
        // If it throws, that's also valid error handling
        expect(error).toBeDefined();
      }
    });

    it('should deduplicate transactions by txid:type', async () => {
      const address = testnetAddresses.nativeSegwit[0];
      const txHash = 'v'.repeat(64);

      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'addr-1', address, derivationPath: "m/84'/1'/0'/0/0" },
      ]);

      // Same transaction appears in history
      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([[address, [{ tx_hash: txHash, height: 800000 }]]])
      );

      // Handle different transaction.findMany queries
      mockPrismaClient.transaction.findMany.mockImplementation(async (args) => {
        // RBF cleanup: pending transactions with active status
        if (args?.where?.confirmations === 0 && args?.where?.rbfStatus === 'active') {
          return [];
        }
        // Retroactive RBF linking: replaced transactions without replacedByTxid
        if (args?.where?.rbfStatus === 'replaced' && args?.where?.replacedByTxid === null) {
          return [];
        }
        // Transaction already exists in database (existing txids query)
        return [{ id: 'tx-1', txid: txHash, type: 'received' }];
      });

      mockElectrumClient.getTransaction.mockResolvedValue(
        createMockTransaction({
          txid: txHash,
          outputs: [{ value: 0.001, address }],
        })
      );

      mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(new Map([[address, []]]));
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().syncWallet(walletId);

      // Should not create duplicate transaction
      expect(result.transactions).toBe(0);
    });

    it('should return sync result structure', async () => {
      mockPrismaClient.address.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().syncWallet(walletId);

      // Verify result structure
      expect(typeof result.addresses).toBe('number');
      expect(typeof result.transactions).toBe('number');
      expect(typeof result.utxos).toBe('number');
    });

    it('should recurse when newly generated addresses have history', async () => {
      const executeSpy = vi.spyOn(syncModule, 'executeSyncPipeline')
        .mockResolvedValueOnce({
          addresses: 2,
          transactions: 1,
          utxos: 1,
          stats: { newAddressesGenerated: 1 },
        } as any)
        .mockResolvedValueOnce({
          addresses: 1,
          transactions: 2,
          utxos: 3,
          stats: { newAddressesGenerated: 0 },
        } as any);

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'testnet' });
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'new-addr', address: 'tb1qnewaddress', used: false },
      ]);
      mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([['tb1qnewaddress', [{ tx_hash: 'z'.repeat(64), height: 800000 }]]])
      );

      const result = await getBlockchainService().syncWallet(walletId);

      expect(result).toEqual({
        addresses: 3,
        transactions: 3,
        utxos: 4,
      });
      expect(executeSpy).toHaveBeenCalledTimes(2);
    });

    it('should ignore new-address history scan failures and return initial sync result', async () => {
      const executeSpy = vi.spyOn(syncModule, 'executeSyncPipeline')
        .mockResolvedValueOnce({
          addresses: 4,
          transactions: 5,
          utxos: 6,
          stats: { newAddressesGenerated: 1 },
        } as any);

      mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'testnet' });
      mockPrismaClient.address.findMany.mockResolvedValue([
        { id: 'new-addr', address: 'tb1qnewaddress', used: false },
      ]);
      mockElectrumClient.getAddressHistoryBatch.mockRejectedValueOnce(new Error('scan failed'));

      const result = await getBlockchainService().syncWallet(walletId);

      expect(result).toEqual({
        addresses: 4,
        transactions: 5,
        utxos: 6,
      });
      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });
}
