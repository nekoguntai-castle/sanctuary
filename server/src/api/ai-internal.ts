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
import { createLogger } from '../utils/logger';
import { notificationService } from '../websocket/notifications';

const log = createLogger('AI-INTERNAL');

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
router.get('/tx/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

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
      return res.status(404).json({ error: 'Transaction not found' });
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

  } catch (error) {
    log.error('Error fetching transaction for AI', { error: String(error) });
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /internal/ai/wallet/:id/labels
 *
 * Returns existing labels in a wallet for AI context.
 * Helps AI suggest labels consistent with user's existing categorization.
 */
router.get('/wallet/:id/labels', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    // Verify wallet access
    const wallet = await prisma.wallet.findFirst({
      where: {
        id,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
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

  } catch (error) {
    log.error('Error fetching labels for AI', { error: String(error) });
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /internal/ai/wallet/:id/context
 *
 * Returns wallet context for natural language queries.
 * Used to help AI understand available data and user's labeling patterns.
 */
router.get('/wallet/:id/context', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    // Verify wallet access
    const wallet = await prisma.wallet.findFirst({
      where: {
        id,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
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

  } catch (error) {
    log.error('Error fetching wallet context for AI', { error: String(error) });
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
