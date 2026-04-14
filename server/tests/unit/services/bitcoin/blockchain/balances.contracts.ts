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

export function registerBlockchainBalanceTests(): void {
  describe('recalculateWalletBalances', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      // Reset mocks for each test
      mockPrismaClient.transaction.findMany.mockReset();
      mockPrismaClient.transaction.update.mockReset();
    });

    it('should calculate running balance for transactions in chronological order', async () => {
      // Setup mock transactions in chronological order (oldest first)
      const mockTransactions = [
        {
          id: 'tx-1',
          txid: 'a'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(100000), // +100000 sats
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
        {
          id: 'tx-2',
          txid: 'b'.repeat(64),
          walletId,
          type: 'sent',
          amount: BigInt(-30000), // -30000 sats (balance should be 70000)
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
          balanceAfter: null,
        },
        {
          id: 'tx-3',
          txid: 'c'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(50000), // +50000 sats (balance should be 120000)
          blockTime: new Date('2024-01-03'),
          createdAt: new Date('2024-01-03'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      // Verify findMany was called with correct parameters
      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { walletId },
          orderBy: expect.anything(),
        })
      );

      // Verify each transaction was updated with correct balanceAfter
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledTimes(3);

      // First transaction: balance = 0 + 100000 = 100000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: { balanceAfter: BigInt(100000) },
      });

      // Second transaction: balance = 100000 - 30000 = 70000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-2' },
        data: { balanceAfter: BigInt(70000) },
      });

      // Third transaction: balance = 70000 + 50000 = 120000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-3' },
        data: { balanceAfter: BigInt(120000) },
      });
    });

    it('should handle empty transaction list', async () => {
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await getBlockchainService().recalculateWalletBalances(walletId);

      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalled();
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('should handle single transaction', async () => {
      const mockTransactions = [
        {
          id: 'tx-only',
          txid: 'd'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(250000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      expect(mockPrismaClient.transaction.update).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-only' },
        data: { balanceAfter: BigInt(250000) },
      });
    });

    it('should handle consolidation transactions (negative amount but internal transfer)', async () => {
      const mockTransactions = [
        {
          id: 'tx-1',
          txid: 'e'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(100000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
        {
          id: 'tx-2',
          txid: 'f'.repeat(64),
          walletId,
          type: 'consolidation',
          amount: BigInt(-1000), // Fee only (consolidation amount is just the fee)
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      // Consolidation reduces balance by fee amount
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-2' },
        data: { balanceAfter: BigInt(99000) }, // 100000 - 1000 fee
      });
    });

    it('should handle transactions with zero amount', async () => {
      const mockTransactions = [
        {
          id: 'tx-1',
          txid: 'g'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(50000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
        {
          id: 'tx-2',
          txid: 'h'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(0), // Edge case: zero amount
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      // Balance should remain unchanged after zero amount transaction
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-2' },
        data: { balanceAfter: BigInt(50000) },
      });
    });

    it('should handle transactions that would result in negative balance', async () => {
      // This tests data integrity - in real scenarios balance should never go negative
      // but the function should still calculate it correctly
      const mockTransactions = [
        {
          id: 'tx-1',
          txid: 'i'.repeat(64),
          walletId,
          type: 'sent',
          amount: BigInt(-50000), // Sending without receiving first
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      // Should still calculate (data issue, but function handles it)
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: { balanceAfter: BigInt(-50000) },
      });
    });

    it('should order transactions by blockTime and createdAt', async () => {
      // Transaction with null blockTime (pending) should use createdAt for ordering
      const mockTransactions = [
        {
          id: 'tx-confirmed',
          txid: 'j'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(100000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
        {
          id: 'tx-pending',
          txid: 'k'.repeat(64),
          walletId,
          type: 'sent',
          amount: BigInt(-20000),
          blockTime: null, // Pending transaction
          createdAt: new Date('2024-01-02'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      // Verify ordering is handled correctly
      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: expect.anything(),
        })
      );

      // Pending transaction should come after confirmed one
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-pending' },
        data: { balanceAfter: BigInt(80000) }, // 100000 - 20000
      });
    });

    it('should handle large balance values', async () => {
      // Test with values close to BTC max supply (21 million BTC = 2.1 quadrillion sats)
      const mockTransactions = [
        {
          id: 'tx-large',
          txid: 'l'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt('2100000000000000'), // 21 million BTC in sats
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-large' },
        data: { balanceAfter: BigInt('2100000000000000') },
      });
    });

    it('should not skip transactions with existing balanceAfter values', async () => {
      // All transactions should be recalculated regardless of existing values
      const mockTransactions = [
        {
          id: 'tx-1',
          txid: 'm'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(100000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: BigInt(50000), // Old/incorrect value
        },
        {
          id: 'tx-2',
          txid: 'n'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(50000),
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
          balanceAfter: BigInt(100000), // Old/incorrect value
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      // Should recalculate all transactions
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledTimes(2);

      // First transaction: 0 + 100000 = 100000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: { balanceAfter: BigInt(100000) },
      });

      // Second transaction: 100000 + 50000 = 150000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-2' },
        data: { balanceAfter: BigInt(150000) },
      });
    });

    it('should handle mixed transaction types', async () => {
      const mockTransactions = [
        {
          id: 'tx-1',
          txid: 'o'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(500000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
        {
          id: 'tx-2',
          txid: 'p'.repeat(64),
          walletId,
          type: 'sent',
          amount: BigInt(-100000),
          blockTime: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
          balanceAfter: null,
        },
        {
          id: 'tx-3',
          txid: 'q'.repeat(64),
          walletId,
          type: 'consolidation',
          amount: BigInt(-500), // Just fee
          blockTime: new Date('2024-01-03'),
          createdAt: new Date('2024-01-03'),
          balanceAfter: null,
        },
        {
          id: 'tx-4',
          txid: 'r'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(200000),
          blockTime: new Date('2024-01-04'),
          createdAt: new Date('2024-01-04'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockResolvedValue({});

      await getBlockchainService().recalculateWalletBalances(walletId);

      expect(mockPrismaClient.transaction.update).toHaveBeenCalledTimes(4);

      // tx-1: 0 + 500000 = 500000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: { balanceAfter: BigInt(500000) },
      });

      // tx-2: 500000 - 100000 = 400000
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-2' },
        data: { balanceAfter: BigInt(400000) },
      });

      // tx-3: 400000 - 500 = 399500
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-3' },
        data: { balanceAfter: BigInt(399500) },
      });

      // tx-4: 399500 + 200000 = 599500
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-4' },
        data: { balanceAfter: BigInt(599500) },
      });
    });

    it('should propagate database errors', async () => {
      mockPrismaClient.transaction.findMany.mockRejectedValue(new Error('Database connection failed'));

      await expect(getBlockchainService().recalculateWalletBalances(walletId)).rejects.toThrow('Database connection failed');
    });

    it('should handle update errors gracefully', async () => {
      const mockTransactions = [
        {
          id: 'tx-1',
          txid: 's'.repeat(64),
          walletId,
          type: 'received',
          amount: BigInt(100000),
          blockTime: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
          balanceAfter: null,
        },
      ];

      mockPrismaClient.transaction.findMany.mockResolvedValue(mockTransactions);
      mockPrismaClient.transaction.update.mockRejectedValue(new Error('Update failed'));

      await expect(getBlockchainService().recalculateWalletBalances(walletId)).rejects.toThrow('Update failed');
    });
  });
}
