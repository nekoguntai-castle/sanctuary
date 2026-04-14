import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  mockPrisma,
} from './blockchainServiceTestHarness';

export function registerBlockchainBalanceCalculationContracts(): void {
describe('Blockchain Service - Balance Calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('correctMisclassifiedConsolidations', () => {
    it('should correct sent transactions that are actually consolidations', async () => {
      const { correctMisclassifiedConsolidations } = await import(
        '../../../../src/services/bitcoin/utils/balanceCalculation'
      );

      // All wallet addresses
      const walletAddresses = [
        { address: 'bc1qwallet1' },
        { address: 'bc1qwallet2' },
      ];

      // Transaction marked as 'sent' but all outputs go to wallet addresses
      const misclassifiedTx = {
        id: 'tx-1',
        txid: 'misclass123',
        type: 'sent',
        fee: BigInt(1000),
        outputs: [
          { id: 'out-1', address: 'bc1qwallet2', isOurs: false },
        ],
      };

      mockPrisma.address.findMany.mockResolvedValue(walletAddresses);
      mockPrisma.transaction.findMany.mockResolvedValue([misclassifiedTx]);
      mockPrisma.transaction.update.mockResolvedValue({});
      mockPrisma.transactionOutput.updateMany.mockResolvedValue({ count: 1 });

      const corrected = await correctMisclassifiedConsolidations('wallet-1');

      expect(corrected).toBe(1);
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: {
          type: 'consolidation',
          amount: BigInt(-1000), // -fee
        },
      });
      expect(mockPrisma.transactionOutput.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['out-1'] } },
        data: { isOurs: true, outputType: 'consolidation' },
      });
    });

    it('should not correct transactions with external outputs', async () => {
      const { correctMisclassifiedConsolidations } = await import(
        '../../../../src/services/bitcoin/utils/balanceCalculation'
      );

      const walletAddresses = [{ address: 'bc1qwallet1' }];

      // Transaction with output to external address - NOT a consolidation
      const legitimateSentTx = {
        id: 'tx-1',
        txid: 'sent123',
        type: 'sent',
        fee: BigInt(1000),
        outputs: [
          { id: 'out-1', address: 'bc1qexternal', isOurs: false },
          { id: 'out-2', address: 'bc1qwallet1', isOurs: true },
        ],
      };

      mockPrisma.address.findMany.mockResolvedValue(walletAddresses);
      mockPrisma.transaction.findMany.mockResolvedValue([legitimateSentTx]);

      const corrected = await correctMisclassifiedConsolidations('wallet-1');

      expect(corrected).toBe(0);
      expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
    });

    it('should skip sent transactions that have no outputs payload', async () => {
      const { correctMisclassifiedConsolidations } = await import(
        '../../../../src/services/bitcoin/utils/balanceCalculation'
      );

      mockPrisma.address.findMany.mockResolvedValue([{ address: 'bc1qwallet1' }]);
      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-no-outputs',
          txid: 'tx-no-outputs',
          type: 'sent',
          fee: BigInt(500),
          outputs: undefined,
        },
      ]);

      const corrected = await correctMisclassifiedConsolidations('wallet-1');

      expect(corrected).toBe(0);
      expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
      expect(mockPrisma.transactionOutput.updateMany).not.toHaveBeenCalled();
    });

    it('should handle consolidation correction when fee is null and outputs are already marked ours', async () => {
      const { correctMisclassifiedConsolidations } = await import(
        '../../../../src/services/bitcoin/utils/balanceCalculation'
      );

      mockPrisma.address.findMany.mockResolvedValue([{ address: 'bc1qwallet1' }]);
      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          id: 'tx-null-fee',
          txid: 'tx-null-fee',
          type: 'sent',
          fee: null,
          outputs: [
            { id: 'out-wallet', address: 'bc1qwallet1', isOurs: true },
            { id: 'out-unknown', address: null, isOurs: false },
          ],
        },
      ]);
      mockPrisma.transaction.update.mockResolvedValue({});

      const corrected = await correctMisclassifiedConsolidations('wallet-1');

      expect(corrected).toBe(1);
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-null-fee' },
        data: {
          type: 'consolidation',
          amount: BigInt(0),
        },
      });
      expect(mockPrisma.transactionOutput.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('recalculateWalletBalances', () => {
    it('should calculate running balance for all transactions', async () => {
      const { recalculateWalletBalances } = await import(
        '../../../../src/services/bitcoin/utils/balanceCalculation'
      );

      const transactions = [
        { id: 'tx-1', amount: BigInt(100000000) }, // +1 BTC
        { id: 'tx-2', amount: BigInt(-50000000) }, // -0.5 BTC
        { id: 'tx-3', amount: BigInt(25000000) }, // +0.25 BTC
      ];

      mockPrisma.transaction.findMany.mockResolvedValue(transactions);
      mockPrisma.transaction.update.mockResolvedValue({});
      mockPrisma.$transaction.mockResolvedValue([]);

      await recalculateWalletBalances('wallet-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Verify the balance calculations
      // After tx-1: 1 BTC
      // After tx-2: 0.5 BTC
      // After tx-3: 0.75 BTC
      const calls = mockPrisma.$transaction.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    it('should handle empty transaction list', async () => {
      const { recalculateWalletBalances } = await import(
        '../../../../src/services/bitcoin/utils/balanceCalculation'
      );

      mockPrisma.transaction.findMany.mockResolvedValue([]);

      await recalculateWalletBalances('wallet-1');

      // Should not call $transaction for empty list
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should batch updates in chunks of 500', async () => {
      const { recalculateWalletBalances } = await import(
        '../../../../src/services/bitcoin/utils/balanceCalculation'
      );

      // Create 600 transactions
      const transactions = Array.from({ length: 600 }, (_, i) => ({
        id: `tx-${i}`,
        amount: BigInt(1000),
      }));

      mockPrisma.transaction.findMany.mockResolvedValue(transactions);
      mockPrisma.transaction.update.mockResolvedValue({});
      mockPrisma.$transaction.mockResolvedValue([]);

      await recalculateWalletBalances('wallet-1');

      // Should call $transaction twice (500 + 100)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});
}
