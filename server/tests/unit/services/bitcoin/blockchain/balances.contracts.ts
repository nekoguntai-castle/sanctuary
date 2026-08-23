import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { getBlockchainService } from './blockchainTestHarness';

export function registerBlockchainBalanceTests(): void {
  describe('recalculateWalletBalances', () => {
    const walletId = 'test-wallet-id';

    beforeEach(() => {
      vi.clearAllMocks();
      mockPrismaClient.$executeRaw.mockResolvedValue(0);
    });

    it('runs the balance repair as a database-side atomic update', async () => {
      mockPrismaClient.$executeRaw
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3);

      await getBlockchainService().recalculateWalletBalances(walletId);

      expect(mockPrismaClient.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { timeout: 60_000 },
      );
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(3);
      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('handles a wallet with no changed running balances', async () => {
      await getBlockchainService().recalculateWalletBalances(walletId);

      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(3);
    });

    it('should propagate database errors', async () => {
      mockPrismaClient.$executeRaw.mockRejectedValue(new Error('Database connection failed'));

      await expect(getBlockchainService().recalculateWalletBalances(walletId)).rejects.toThrow('Database connection failed');
    });

    it('defers fenced balance-recalculation logging until after commit', async () => {
      mockPrismaClient.$executeRaw
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3);
      const effects: Array<() => void | Promise<void>> = [];

      await getBlockchainService().recalculateWalletBalances(
        walletId,
        mockPrismaClient as never,
        effect => effects.push(effect),
      );

      expect(effects).toHaveLength(1);
      await effects[0]();
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('correctMisclassifiedConsolidations compatibility', () => {
    it('defers correction and summary logs when a caller owns the transaction', async () => {
      mockPrismaClient.address.findMany.mockResolvedValueOnce([{ address: 'wallet-address' }]);
      mockPrismaClient.transaction.findMany.mockResolvedValueOnce([{
        id: 'sent-row',
        txid: 'sent-tx',
        fee: BigInt(25),
        outputs: [{ address: 'wallet-address' }],
      }]);
      mockPrismaClient.transaction.updateMany.mockResolvedValueOnce({ count: 1 });
      const effects: Array<() => void | Promise<void>> = [];

      await expect(getBlockchainService().correctMisclassifiedConsolidations(
        'test-wallet-id',
        mockPrismaClient as never,
        effect => effects.push(effect),
      )).resolves.toBe(1);

      expect(effects).toHaveLength(2);
      for (const effect of effects) await effect();
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    });
  });

}
