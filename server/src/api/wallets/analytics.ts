/**
 * Wallets - Analytics Router
 *
 * Wallet statistics and balance history for charts
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { transactionRepository, utxoRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import { walletCache } from '../../services/cache';
import * as walletService from '../../services/wallet';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();

/**
 * GET /api/v1/wallets/:id/stats
 * Get wallet statistics
 */
router.get('/:id/stats', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const walletId = req.walletId!;

  const stats = await walletService.getWalletStats(walletId, userId);

  res.json(stats);
}));

/**
 * GET /api/v1/wallets/:id/balance-history
 * Get balance history data points for charts
 * OPTIMIZED: Returns only relevant data points instead of all transactions
 */
router.get('/:id/balance-history', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const timeframe = (req.query.timeframe as string) || '1M';

  // Check cache first
  const cacheKey = `balance-history:${walletId}:${timeframe}`;
  const cached = await walletCache.get<{
    currentBalance: number;
    dataPoints: Array<{ timestamp: string; balance: number }>;
  }>(cacheKey);
  if (cached) {
    return res.json({
      timeframe,
      ...cached,
    });
  }

  // Calculate date range
  const now = Date.now();
  const day = 86400000;
  const rangeMs: Record<string, number> = {
    '1D': day,
    '1W': 7 * day,
    '1M': 30 * day,
    '1Y': 365 * day,
    'ALL': 5 * 365 * day,
  };

  const startDate = new Date(now - (rangeMs[timeframe] || rangeMs['1M']));

  // Fetch only relevant transactions with balanceAfter
  const transactions = await transactionRepository.findForBalanceHistory(walletId, startDate);

  // Get current balance for end point
  const balance = Number(await utxoRepository.getUnspentBalance(walletId));

  // Sample to max 100 data points for efficiency
  const maxPoints = 100;
  const step = Math.max(1, Math.floor(transactions.length / maxPoints));
  const sampled = transactions.filter((_, i) => i % step === 0 || i === transactions.length - 1);

  // Build response
  const data = sampled.map(tx => ({
    timestamp: tx.blockTime?.toISOString() || '',
    balance: Number(tx.balanceAfter || 0),
  }));

  // Add current balance as final point if data exists
  if (data.length > 0) {
    data.push({
      timestamp: new Date().toISOString(),
      balance,
    });
  }

  // Cache the result (10 second TTL matching original)
  const result = {
    currentBalance: balance,
    dataPoints: data,
  };
  await walletCache.set(cacheKey, result, 10);

  res.json({
    timeframe,
    ...result,
  });
}));

export default router;
