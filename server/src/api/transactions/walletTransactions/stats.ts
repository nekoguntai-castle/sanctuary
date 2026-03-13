/**
 * Wallet Transactions - Stats Route
 *
 * Endpoint for transaction summary statistics with caching.
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { db as prisma } from '../../../repositories/db';
import { handleApiError, bigIntToNumberOrZero } from '../../../utils/errors';
import { walletCache } from '../../../services/cache';

/**
 * Create the transaction stats router
 */
export function createStatsRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/wallets/:walletId/transactions/stats
   * Get transaction summary statistics for a wallet
   * Returns counts and totals independent of pagination
   * CACHED: Results are cached for 30 seconds to reduce database load
   */
  router.get('/wallets/:walletId/transactions/stats', requireWalletAccess('view'), async (req: Request, res: Response) => {
    try {
      const walletId = req.walletId!;

      // Use cache to reduce database load for frequently accessed stats (30 second TTL)
      const cacheKey = `tx-stats:${walletId}`;

      interface TxStatsCache {
        totalSent: string;
        totalReceived: string;
        transactionCount: number;
        avgFee: string;
        totalFees: string;
        currentBalance: string;
        _receivedCount: number;
        _sentCount: number;
        _consolidationCount: number;
      }

      let stats = await walletCache.get<TxStatsCache>(cacheKey);

      if (!stats) {
        // OPTIMIZED: Use aggregate queries instead of loading all transactions
        const [typeStats, feeStats, lastTx] = await Promise.all([
          prisma.transaction.groupBy({
            by: ['type'],
            where: { walletId },
            _count: { id: true },
            _sum: { amount: true },
          }),
          prisma.transaction.aggregate({
            where: {
              walletId,
              type: { in: ['sent', 'consolidation'] },
              fee: { gt: 0 },
            },
            _sum: { fee: true },
          }),
          prisma.transaction.findFirst({
            where: { walletId },
            orderBy: [
              { blockTime: { sort: 'desc', nulls: 'first' } },
              { createdAt: 'desc' },
            ],
            select: { balanceAfter: true },
          }),
        ]);

        // Extract stats from grouped results
        let totalCount = 0;
        let receivedCount = 0;
        let sentCount = 0;
        let consolidationCount = 0;
        let totalReceived = BigInt(0);
        let totalSent = BigInt(0);

        for (const stat of typeStats) {
          const count = stat._count.id;
          const amount = stat._sum.amount || BigInt(0);
          totalCount += count;

          if (stat.type === 'received') {
            receivedCount = count;
            totalReceived = amount > 0 ? amount : -amount;
          } else if (stat.type === 'sent') {
            sentCount = count;
            totalSent = amount < 0 ? -amount : amount;
          } else if (stat.type === 'consolidation') {
            consolidationCount = count;
          }
        }

        const totalFees = feeStats._sum.fee || BigInt(0);
        const walletBalance = lastTx?.balanceAfter ?? BigInt(0);

        // Store as strings for cache (BigInt not serializable)
        stats = {
          totalSent: totalSent.toString(),
          totalReceived: totalReceived.toString(),
          transactionCount: totalCount,
          avgFee: totalCount > 0 ? (Number(totalFees) / totalCount).toString() : '0',
          totalFees: totalFees.toString(),
          currentBalance: walletBalance.toString(),
          // Include detailed counts for response
          _receivedCount: receivedCount,
          _sentCount: sentCount,
          _consolidationCount: consolidationCount,
        };

        await walletCache.set(cacheKey, stats, 30);
      }

      res.json({
        totalCount: stats.transactionCount,
        receivedCount: stats._receivedCount,
        sentCount: stats._sentCount,
        consolidationCount: stats._consolidationCount,
        totalReceived: bigIntToNumberOrZero(BigInt(stats.totalReceived)),
        totalSent: bigIntToNumberOrZero(BigInt(stats.totalSent)),
        totalFees: bigIntToNumberOrZero(BigInt(stats.totalFees)),
        walletBalance: bigIntToNumberOrZero(BigInt(stats.currentBalance)),
      });
    } catch (error: unknown) {
      handleApiError(error, res, 'Get transaction stats');
    }
  });

  return router;
}
