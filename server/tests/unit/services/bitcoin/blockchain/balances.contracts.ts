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
  });
}
