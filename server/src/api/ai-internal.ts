/**
 * Internal AI Endpoints
 *
 * These endpoints are ONLY accessible by the AI container.
 * They provide sanitized, read-only access to transaction metadata.
 *
 * SECURITY:
 * - IP-restricted: Only accessible from Docker internal network
 * - Read-only: Cannot modify any data
 * - Sanitized: Strips sensitive fields before returning
 * - No secrets: Never exposes keys, passwords, or signing data
 * - Authenticated: Requires valid JWT (passed through from original request)
 *
 * DATA POLICY:
 * - Amount: ✓ Included
 * - Direction: ✓ Included
 * - Date: ✓ Included
 * - Labels: ✓ Included
 * - Confirmations: ✓ Included
 * - Address: ✗ NOT included (privacy)
 * - TxID: ✗ NOT included (privacy)
 * - Private keys: ✗ NEVER (security)
 * - Passwords: ✗ NEVER (security)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db as prisma } from '../repositories/db';
import { buildWalletAccessWhere } from '../repositories/accessControl';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { notificationService } from '../websocket/notifications';
import { asyncHandler } from '../errors/errorHandler';
import { NotFoundError } from '../errors/ApiError';
// Dynamic imports - kept as dynamic because test mocks use vi.mock factories
// that are hoisted above static imports, causing initialization errors

const log = createLogger('AI_INTERNAL:ROUTE');

const router = Router();

/**
 * IP-based access control for internal AI endpoints.
 * Only allows requests from Docker internal networks (private IP ranges).
 * This ensures only the AI container can access these endpoints.
 */
const restrictToInternalNetwork = (req: Request, res: Response, next: NextFunction) => {
  // Use req.ip which respects Express's trust proxy setting,
  // preventing X-Forwarded-For spoofing
  const clientIp = req.ip || req.socket.remoteAddress || '';

  // Check if IP is from a private range (Docker internal networks)
  // Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, localhost
  const isPrivateIp = (ip: string): boolean => {
    // Handle IPv6-mapped IPv4 addresses (::ffff:x.x.x.x)
    const normalizedIp = ip.replace(/^::ffff:/, '');

    // Localhost
    if (normalizedIp === '127.0.0.1' || normalizedIp === '::1' || normalizedIp === 'localhost') {
      return true;
    }

    // Parse IPv4
    const parts = normalizedIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      // Not a valid IPv4 address - reject
      return false;
    }

    // 10.0.0.0/8
    if (parts[0] === 10) return true;

    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;

    return false;
  };

  if (!isPrivateIp(clientIp)) {
    log.warn('Blocked access to internal AI endpoint from non-private IP', { ip: clientIp });
    return res.status(403).json({ error: 'Access denied: internal endpoint' });
  }

  next();
};

// Apply internal network restriction to all routes
router.use(restrictToInternalNetwork);

/**
 * POST /internal/ai/pull-progress
 *
 * Receives progress updates from AI container during model pulls.
 * Broadcasts progress to connected WebSocket clients.
 *
 * Note: This endpoint only requires internal network access (no JWT auth)
 * since it's called by the AI container, not a user.
 */
router.post('/pull-progress', (req: Request, res: Response) => {
  try {
    const { model, status, completed, total, digest, error } = req.body;

    if (!model || !status) {
      return res.status(400).json({ error: 'model and status required' });
    }

    // Calculate percent
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Broadcast to connected clients
    notificationService.broadcastModelDownloadProgress({
      model,
      status,
      completed: completed || 0,
      total: total || 0,
      percent,
      digest,
      error,
    });

    res.json({ ok: true });
  } catch (err) {
    log.error('Error processing pull progress', { error: String(err) });
    res.status(500).json({ error: 'Internal error' });
  }
});

// Other internal AI endpoints also require JWT authentication
router.use(authenticate);

/**
 * GET /internal/ai/tx/:id
 *
 * Returns sanitized transaction metadata for AI label suggestions.
 * DOES NOT include: address, txid, or any identifying information.
 */
router.get('/tx/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  // Fetch transaction with wallet access check
  const transaction = await prisma.transaction.findFirst({
    where: {
      id,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
    select: {
      // ONLY select non-sensitive fields
      id: true,
      amount: true,
      type: true,
      blockTime: true,
      createdAt: true,
      confirmations: true,
      walletId: true,
      // DO NOT select: txid, address, or any other identifying info
    },
  });

  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }

  // Return SANITIZED data only
  res.json({
    walletId: transaction.walletId,
    amount: Math.abs(Number(transaction.amount)), // Always positive
    direction: Number(transaction.amount) >= 0 ? 'receive' : 'send',
    date: (transaction.blockTime || transaction.createdAt).toISOString(),
    confirmations: transaction.confirmations,
    // Note: We intentionally do NOT include txid or address
  });
}));

/**
 * GET /internal/ai/wallet/:id/labels
 *
 * Returns existing labels in a wallet for AI context.
 * Helps AI suggest labels consistent with user's existing categorization.
 */
router.get('/wallet/:id/labels', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  // Verify wallet access
  const wallet = await prisma.wallet.findFirst({
    where: { id, ...buildWalletAccessWhere(userId) },
  });

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  // Fetch recent labels
  const labels = await prisma.label.findMany({
    where: { walletId: id },
    select: { name: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json({
    labels: labels.map(l => l.name),
  });
}));

/**
 * GET /internal/ai/wallet/:id/context
 *
 * Returns wallet context for natural language queries.
 * Used to help AI understand available data and user's labeling patterns.
 */
router.get('/wallet/:id/context', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  // Verify wallet access
  const wallet = await prisma.wallet.findFirst({
    where: { id, ...buildWalletAccessWhere(userId) },
  });

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  // Fetch summary stats (no sensitive data)
  const [labels, txCount, addressCount, utxoCount] = await Promise.all([
    prisma.label.findMany({
      where: { walletId: id },
      select: { name: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.transaction.count({ where: { walletId: id } }),
    prisma.address.count({ where: { walletId: id } }),
    prisma.uTXO.count({ where: { walletId: id, spent: false } }),
  ]);

  res.json({
    labels: labels.map(l => l.name),
    stats: {
      transactionCount: txCount,
      addressCount: addressCount,
      utxoCount: utxoCount,
    },
    // DO NOT include: balance, addresses, txids, or any identifying info
  });
}));

// ========================================
// TREASURY INTELLIGENCE ENDPOINTS
// ========================================

/**
 * GET /internal/ai/wallet/:id/utxo-health
 *
 * Returns sanitized UTXO health profile for treasury analysis.
 * DOES NOT include: addresses, txids, or any identifying information.
 */
router.get('/wallet/:id/utxo-health', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  const wallet = await prisma.wallet.findFirst({
    where: { id, ...buildWalletAccessWhere(userId) },
  });

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  try {
    const { getUtxoHealthProfile } = await import('../services/autopilot/utxoHealth');
    const health = await getUtxoHealthProfile(id, 10_000); // default dust threshold

    res.json({
      totalUtxos: health.totalUtxos,
      dustCount: health.dustCount,
      dustValueSats: Number(health.dustValue),
      totalValueSats: Number(health.totalValue),
      avgUtxoSizeSats: Number(health.avgUtxoSize),
      consolidationCandidates: health.consolidationCandidates,
      distribution: {
        dust: health.dustCount,
        small: Math.max(0, health.consolidationCandidates - health.dustCount),
        total: health.totalUtxos,
      },
    });
  } catch (error) {
    log.error('Failed to get UTXO health', { walletId: id, error: getErrorMessage(error) });
    res.json({
      totalUtxos: 0, dustCount: 0, dustValueSats: 0, totalValueSats: 0,
      avgUtxoSizeSats: 0, consolidationCandidates: 0,
      distribution: { dust: 0, small: 0, total: 0 },
    });
  }
}));

/**
 * GET /internal/ai/wallet/:id/fee-history
 *
 * Returns recent fee snapshots for fee timing analysis.
 * Aggregate data only — no identifying information.
 */
router.get('/wallet/:id/fee-history', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  const wallet = await prisma.wallet.findFirst({
    where: { id, ...buildWalletAccessWhere(userId) },
  });

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  try {
    const { getRecentFees, getLatestFeeSnapshot } = await import('../services/autopilot/feeMonitor');
    const snapshots = await getRecentFees(1440); // 24 hours
    const latest = await getLatestFeeSnapshot();

    // Determine trend
    let trend: 'rising' | 'falling' | 'stable' = 'stable';
    if (snapshots.length >= 2) {
      const recent = snapshots.slice(-6);
      const avgRecent = recent.reduce((s, f) => s + f.economy, 0) / recent.length;
      const older = snapshots.slice(0, Math.min(6, snapshots.length));
      const avgOlder = older.reduce((s, f) => s + f.economy, 0) / older.length;
      if (avgRecent < avgOlder * 0.8) trend = 'falling';
      else if (avgRecent > avgOlder * 1.2) trend = 'rising';
    }

    res.json({
      snapshots: snapshots.map(s => ({
        timestamp: s.timestamp,
        economy: s.economy,
        minimum: s.minimum,
        fastest: s.fastest,
      })),
      trend,
      currentEconomy: latest?.economy ?? null,
      snapshotCount: snapshots.length,
    });
  } catch (error) {
    log.error('Failed to get fee history', { walletId: id, error: getErrorMessage(error) });
    res.json({ snapshots: [], trend: 'stable', currentEconomy: null, snapshotCount: 0 });
  }
}));

/**
 * GET /internal/ai/wallet/:id/spending-velocity
 *
 * Returns aggregated spending velocity data for anomaly detection.
 * Aggregate counts/amounts only — no addresses or txids.
 */
router.get('/wallet/:id/spending-velocity', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  const wallet = await prisma.wallet.findFirst({
    where: { id, ...buildWalletAccessWhere(userId) },
  });

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const now = new Date();
  const periods = [
    { label: '24h', days: 1 },
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
  ];

  const results = await Promise.all(periods.map(period => {
    const cutoff = new Date(now.getTime() - period.days * 86400000);
    return prisma.transaction.aggregate({
      where: { walletId: id, type: 'sent', blockTime: { gte: cutoff } },
      _count: { _all: true },
      _sum: { amount: true },
    });
  }));

  const velocity: Record<string, { count: number; totalSats: number }> = {};
  periods.forEach((period, i) => {
    velocity[period.label] = {
      count: results[i]._count?._all ?? 0,
      totalSats: Math.abs(Number(results[i]._sum?.amount ?? 0)),
    };
  });

  const avgDaily90d = velocity['90d'].count > 0
    ? velocity['90d'].totalSats / 90
    : 0;

  res.json({
    ...velocity,
    averageDailySpend90d: Math.round(avgDaily90d),
    currentDayVsAverage: avgDaily90d > 0
      ? Number((velocity['24h'].totalSats / avgDaily90d).toFixed(2))
      : 0,
  });
}));

/**
 * GET /internal/ai/wallet/:id/utxo-age-profile
 *
 * Returns UTXO age distribution for tax intelligence.
 * Aggregate counts and sums only — no addresses or txids.
 */
router.get('/wallet/:id/utxo-age-profile', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.userId;

  const wallet = await prisma.wallet.findFirst({
    where: { id, ...buildWalletAccessWhere(userId) },
  });

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const { intelligenceRepository } = await import('../repositories/intelligenceRepository');
  const distribution = await intelligenceRepository.getUtxoAgeDistribution(id);

  // Find UTXOs approaching long-term threshold
  const now = new Date();
  const milestoneResults = await Promise.all([15, 30, 60].map(async (daysAhead) => {
    const windowStart = new Date(now.getTime() - (365 - daysAhead) * 86400000);
    const windowEnd = new Date(now.getTime() - (365 - daysAhead - 1) * 86400000);
    const agg = await prisma.uTXO.aggregate({
      where: { walletId: id, spent: false, createdAt: { gte: windowStart, lt: windowEnd } },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const count = agg._count?._all ?? 0;
    return count > 0 ? { daysUntilLongTerm: daysAhead, count, totalSats: Number(agg._sum?.amount ?? 0) } : null;
  }));
  const upcomingMilestones = milestoneResults.filter((m): m is NonNullable<typeof m> => m !== null);

  res.json({
    shortTerm: {
      count: distribution.shortTerm.count,
      totalSats: Number(distribution.shortTerm.totalSats),
    },
    longTerm: {
      count: distribution.longTerm.count,
      totalSats: Number(distribution.longTerm.totalSats),
    },
    thresholdDays: 365,
    upcomingLongTerm: upcomingMilestones,
  });
}));

export default router;
