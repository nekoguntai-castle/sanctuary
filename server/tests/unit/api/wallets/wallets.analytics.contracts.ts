import { describe, expect, it, vi } from 'vitest';
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
    it('ALL includes retained history older than five years with an epoch lower bound', async () => {
      const old = { blockTime: new Date('2010-01-01T00:00:00.000Z'), balanceAfter: BigInt(42) };
      mockTransactionRepository.findForBalanceHistory.mockImplementationOnce(async (_walletId: string, start: Date) =>
        [old].filter(tx => tx.blockTime >= start));
      mockUtxoRepository.getUnspentBalance.mockResolvedValueOnce(BigInt(42));

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/balance-history?timeframe=ALL');

      expect(response.status).toBe(200);
      expect(mockTransactionRepository.findForBalanceHistory).toHaveBeenCalledWith('wallet-123', new Date(0));
      expect(response.body.dataPoints).toContainEqual({ timestamp: old.blockTime.toISOString(), balance: 42 });
    });

    it.each(['', '?timeframe=INVALID', '?timeframe=', '?timeframe=1D&timeframe=ALL'])(
      'normalizes omitted or invalid query %s to the monthly response and cache identity', async query => {
        mockTransactionRepository.findForBalanceHistory.mockResolvedValueOnce([]);
        mockUtxoRepository.getUnspentBalance.mockResolvedValueOnce(BigInt(7));
        const before = Date.now();
        const response = await request(walletRouter).get(`/api/v1/wallets/wallet-123/balance-history${query}`);
        const after = Date.now();

        expect(response.status).toBe(200);
        expect(response.body.timeframe).toBe('1M');
        expect(mockWalletCache.get).toHaveBeenCalledWith('balance-history:wallet-123:1M');
        expect(mockWalletCache.set).toHaveBeenCalledWith('balance-history:wallet-123:1M', {
          currentBalance: 7, dataPoints: [],
        }, 10);
        const start = mockTransactionRepository.findForBalanceHistory.mock.calls[0][1] as Date;
        expect(start.getTime()).toBeGreaterThanOrEqual(before - 30 * 86400000);
        expect(start.getTime()).toBeLessThanOrEqual(after - 30 * 86400000);
      },
    );

    it.each([['1D', 1], ['1W', 7], ['1M', 30], ['1Y', 365]] as const)(
      'preserves the valid %s range', async (timeframe, days) => {
        const now = Date.UTC(2026, 8, 26);
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        try {
          mockTransactionRepository.findForBalanceHistory.mockResolvedValueOnce([]);
          mockUtxoRepository.getUnspentBalance.mockResolvedValueOnce(BigInt(0));
          const response = await request(walletRouter).get(`/api/v1/wallets/wallet-123/balance-history?timeframe=${timeframe}`);
          expect(response.status).toBe(200);
          expect(response.body.timeframe).toBe(timeframe);
          expect(mockTransactionRepository.findForBalanceHistory).toHaveBeenCalledWith(
            'wallet-123', new Date(now - days * 86400000),
          );
        } finally {
          clock.mockRestore();
        }
      },
    );

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

    it('uses the normalized monthly cache for invalid input', async () => {
      mockWalletCache.get.mockResolvedValueOnce({
        currentBalance: 200000,
        dataPoints: [{ timestamp: '2024-01-01', balance: 200000 }],
      });

      const response = await request(walletRouter).get('/api/v1/wallets/wallet-123/balance-history?timeframe=INVALID');

      expect(response.status).toBe(200);
      expect(response.body.timeframe).toBe('1M');
      expect(mockWalletCache.get).toHaveBeenCalledWith('balance-history:wallet-123:1M');
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
      expect(response.body.timeframe).toBe('1M');
      expect(response.body.currentBalance).toBe(999999);
      expect(response.body.dataPoints.length).toBe(103);
      expect(response.body.dataPoints.some((point: any) => point.timestamp === '')).toBe(true);
      expect(response.body.dataPoints.some((point: any) => point.balance === 0)).toBe(true);
      expect(response.body.dataPoints.at(-1).balance).toBe(999999);

      const latestHistoryCall = mockTransactionRepository.findForBalanceHistory.mock.calls.at(-1);
      expect(latestHistoryCall).toBeDefined();
      if (!latestHistoryCall) {
        throw new Error('Expected balance history repository to be called');
      }
      const [, startDateArg] = latestHistoryCall;
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
