import { describe, expect, it } from 'vitest';
import { mockGetWalletStats, mockTransactionRepository, mockUtxoRepository, mockWalletCache, request, walletRouter } from './walletsTestHarness';

export const registerWalletAnalyticsContracts = () => {
  // ==================== Analytics Tests ====================

  describe('GET /wallets/:id/stats', () => {
    it('should return wallet statistics', async () => {
      const mockStats = {
        balance: 100000,
        transactionCount: 15,
        addressCount: 10,
        utxoCount: 5,
      };

      mockGetWalletStats.mockResolvedValue(mockStats);

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/stats');

      expect(response.status).toBe(200);
      expect(response.body.balance).toBe(100000);
      expect(response.body.transactionCount).toBe(15);
    });

    it('should handle stats error', async () => {
      mockGetWalletStats.mockRejectedValue(new Error('Stats error'));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/stats');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /wallets/:id/balance-history', () => {
    it('should return balance history data', async () => {
      mockTransactionRepository.findForBalanceHistory.mockResolvedValue([
        { txid: 'tx1', blockTime: new Date('2024-01-01'), balanceAfter: BigInt(50000) },
        { txid: 'tx2', blockTime: new Date('2024-01-15'), balanceAfter: BigInt(100000) },
      ]);
      mockUtxoRepository.getUnspentBalance.mockResolvedValue(BigInt(100000));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/balance-history?timeframe=1M');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('1M');
      expect(response.body.currentBalance).toBe(100000);
      expect(response.body.dataPoints).toBeDefined();
    });

    it('should use cached data when available', async () => {
      mockWalletCache.get.mockResolvedValueOnce({
        currentBalance: 200000,
        dataPoints: [{ timestamp: '2024-01-01', balance: 200000 }],
      });

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/balance-history');

      expect(response.status).toBe(200);
      expect(response.body.currentBalance).toBe(200000);
      expect(mockTransactionRepository.findForBalanceHistory).not.toHaveBeenCalled();
    });

    it('should default unknown timeframe, include final sampled point, and normalize missing tx fields', async () => {
      const transactions = Array.from({ length: 202 }, (_, i) => ({
        txid: `tx-${i}`,
        blockTime: i === 201 ? undefined : new Date(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`),
        balanceAfter: i === 201 ? undefined : BigInt(i + 1),
      }));
      mockTransactionRepository.findForBalanceHistory.mockResolvedValueOnce(transactions);
      mockUtxoRepository.getUnspentBalance.mockResolvedValueOnce(BigInt(999999));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/balance-history?timeframe=INVALID');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('INVALID');
      expect(response.body.currentBalance).toBe(999999);
      expect(response.body.dataPoints.length).toBe(103);
      expect(response.body.dataPoints.some((point: any) => point.timestamp === '')).toBe(true);
      expect(response.body.dataPoints.some((point: any) => point.balance === 0)).toBe(true);
      expect(response.body.dataPoints.at(-1).balance).toBe(999999);

      const [, startDateArg] = mockTransactionRepository.findForBalanceHistory.mock.calls.at(-1);
      const startDateMs = new Date(startDateArg).getTime();
      const ageMs = Date.now() - startDateMs;
      const twentyEightDays = 28 * 86400000;
      const thirtyTwoDays = 32 * 86400000;
      expect(ageMs).toBeGreaterThan(twentyEightDays);
      expect(ageMs).toBeLessThan(thirtyTwoDays);
    });

    it('should return empty data points when there is no history', async () => {
      mockTransactionRepository.findForBalanceHistory.mockResolvedValueOnce([]);
      mockUtxoRepository.getUnspentBalance.mockResolvedValueOnce(BigInt(123456));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/balance-history?timeframe=1D');

      expect(response.status).toBe(200);
      expect(response.body.currentBalance).toBe(123456);
      expect(response.body.dataPoints).toEqual([]);
    });

    it('should handle balance history error', async () => {
      mockTransactionRepository.findForBalanceHistory.mockRejectedValue(new Error('DB error'));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/balance-history');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
};
