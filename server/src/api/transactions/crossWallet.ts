/**
 * Transactions - Cross-Wallet Router
 *
 * Endpoints for aggregated transaction data across all user's wallets
 * These are optimized aggregate endpoints that replace N separate API calls
 */

import { Router } from 'express';
import { z } from 'zod';
import { walletRepository, transactionRepository, utxoRepository } from '../../repositories';
import { buildWalletAccessWhere } from '../../repositories/accessControl';
import { asyncHandler } from '../../errors/errorHandler';
import { bigIntToNumber, bigIntToNumberOrZero } from '../../utils/errors';
import { getCachedBlockHeight, type Network } from '../../services/bitcoin/blockchain';
import { requireAuthenticatedUser } from '../../middleware/auth';
import { walletCache } from '../../services/cache';

/**
 * Both directions are carried separately and both are positive magnitudes.
 * `latestAt` is an ISO string so the cached shape stays JSON-serialisable.
 */
interface ActivitySummaryPayload {
  count: number;
  receivedSats: number;
  sentSats: number;
  latestAt: string | null;
}

/** Pagination for recent transactions (max 50, default 10) */
const RecentTxLimitSchema = z.coerce.number().int().catch(10).transform(v => Math.max(1, Math.min(v, 50)));

/**
 * How many rows to skip before the page (default 0).
 *
 * Negative values clamp to 0 rather than erroring: this is a read-only preview
 * endpoint, and a nonsensical offset should return the first page, not a 400.
 */
const RecentTxOffsetSchema = z.coerce.number().int().catch(0).transform(v => Math.max(0, v));

/** Total balance param (defaults to 0 for invalid input) */
const TotalBalanceSchema = z.coerce.number().int().catch(0);

/**
 * The documented period set. Validated rather than passed through: an
 * unrecognised value would otherwise fall through `getTimeframeStartDate` to
 * epoch and silently return all-time figures under a one-week label, and — for
 * the cached activity summary — mint an unbounded number of cache keys from a
 * caller-controlled string.
 */
const TimeframeSchema = z.enum(['1D', '1W', '1M', '1Y', 'ALL']).catch('1W');

/**
 * Ceiling on how many wallet ids a caller may name at once.
 *
 * Unbounded, the list flows straight into a Prisma `id: { in: [...] }` clause
 * and — for the cached summary — into the cache key, letting one request build
 * an arbitrarily large query and a combinatorial number of 30s cache entries.
 * Well above any real wallet count; the filter is a convenience, not a limit on
 * what the user owns.
 */
const MAX_REQUESTED_WALLET_IDS = 200;

function parseRequestedWalletIds(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }

  const ids = raw.split(',').filter(Boolean).slice(0, MAX_REQUESTED_WALLET_IDS);
  return ids.length > 0 ? ids : null;
}

const router = Router();

/**
 * Calculate confirmations dynamically from block height using cached current height
 * This avoids network calls while providing accurate confirmation counts
 */
function calculateConfirmations(txBlockHeight: number | null, cachedHeight: number): number {
  if (!txBlockHeight || txBlockHeight <= 0 || cachedHeight <= 0) return 0;
  return Math.max(0, cachedHeight - txBlockHeight + 1);
}

/**
 * Helper to get timeframe start date
 */
function getTimeframeStartDate(timeframe: string): Date {
  const now = new Date();
  switch (timeframe) {
    case '1D':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '1W':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '1M':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '1Y':
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case 'ALL':
    default:
      return new Date(0); // Beginning of time
  }
}

type BucketUnit = 'hour' | 'day' | 'week' | 'month';

function getBucketConfig(timeframe: string): { unit: BucketUnit; label: (date: Date) => string } {
  switch (timeframe) {
    case '1D':
      return {
        unit: 'hour',
        label: (date) => date.toLocaleTimeString(undefined, { hour: 'numeric' }),
      };
    case '1Y':
      return {
        unit: 'week',
        label: (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      };
    case 'ALL':
      return {
        unit: 'month',
        label: (date) => date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      };
    case '1W':
    case '1M':
    default:
      return {
        unit: 'day',
        label: (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      };
  }
}

// getBucketedBalanceDeltas has been moved to transactionRepository

/**
 * GET /api/v1/transactions/recent
 * Get recent transactions across all wallets the user has access to
 * This is an optimized aggregate endpoint that replaces N separate API calls
 *
 * Query params:
 * - limit: max transactions to return (default: 10, max: 50)
 * - walletIds: comma-separated list of wallet IDs to filter (optional)
 */
router.get('/transactions/recent', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  /* v8 ignore next -- schema catch provides default for malformed query input */
  const limit = RecentTxLimitSchema.safeParse(req.query.limit).data ?? 10;
  /* v8 ignore next -- schema catch provides default for malformed query input */
  const offset = RecentTxOffsetSchema.safeParse(req.query.offset).data ?? 0;
  const requestedWalletIds = req.query.walletIds
    ? (req.query.walletIds as string).split(',').filter(Boolean)
    : null;

  // Get all wallet IDs the user has access to (include network for block height lookups)
  const accessibleWallets = await walletRepository.findAccessibleWithSelect(
    userId,
    { id: true, name: true, network: true },
    requestedWalletIds ? { id: { in: requestedWalletIds } } : undefined,
  );

  if (accessibleWallets.length === 0) {
    return res.json([]);
  }

  const walletIds = accessibleWallets.map(w => w.id);
  const walletNameMap = new Map(accessibleWallets.map(w => [w.id, w.name]));
  const walletNetworkMap = new Map(accessibleWallets.map(w => [w.id, w.network as Network]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactions: any[] = await transactionRepository.findByWalletIdsWithDetails(walletIds, {
    where: {
      // Exclude replaced RBF transactions which are no longer in mempool
      // These show as "pending" forever since they'll never confirm
      rbfStatus: { not: 'replaced' },
    },
    include: {
      address: {
        select: {
          address: true,
          derivationPath: true,
        },
      },
      transactionLabels: {
        include: {
          label: true,
        },
      },
    },
    // Sort pending transactions (null blockTime) first, then by date descending.
    //
    // `id` is the tie-breaker, not decoration: without a total order, rows that
    // share a blockTime and createdAt can come back in a different order per
    // query, so a paged reader could see the same row twice or skip one
    // entirely. Only relevant once offset exists.
    orderBy: [
      { blockTime: { sort: 'desc', nulls: 'first' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit,
    skip: offset,
  });

  // Build frozen/locked state from unspent outputs created by each transaction.
  // This lets the UI show lock indicators in Recent Activity.
  const txids = [...new Set(transactions.map(tx => tx.txid))];
  /* v8 ignore next -- no-transaction branch is a defensive empty-list optimization */
  const utxos = txids.length > 0
    ? await utxoRepository.findByTxidsUnspent(walletIds, txids)
    : [];

  const txStateMap = new Map<string, { isFrozen: boolean; isLocked: boolean; lockedByDraftLabel?: string }>();
  for (const utxo of utxos) {
    const key = `${utxo.walletId}:${utxo.txid}`;
    const previous = txStateMap.get(key) ?? { isFrozen: false, isLocked: false, lockedByDraftLabel: undefined };
    txStateMap.set(key, {
      isFrozen: previous.isFrozen || utxo.frozen,
      isLocked: previous.isLocked || !!utxo.draftLock,
      lockedByDraftLabel: previous.lockedByDraftLabel || utxo.draftLock?.draft?.label || undefined,
    });
  }

  // Serialize transactions with wallet name included
  const serializedTransactions = transactions.map(tx => {
    const blockHeight = bigIntToNumber(tx.blockHeight);
    const rawAmount = bigIntToNumberOrZero(tx.amount);
    // Get cached block height for this wallet's network (no network call)
    const network = walletNetworkMap.get(tx.walletId) || 'mainnet';
    const currentHeight = getCachedBlockHeight(network);
    const state = txStateMap.get(`${tx.walletId}:${tx.txid}`);

    return {
      ...tx,
      amount: rawAmount,
      fee: bigIntToNumber(tx.fee),
      balanceAfter: bigIntToNumber(tx.balanceAfter),
      blockHeight,
      // Calculate confirmations dynamically from cached block height for this network
      confirmations: currentHeight > 0 ? calculateConfirmations(blockHeight, currentHeight) : tx.confirmations,
      labels: tx.transactionLabels.map((tl: any) => tl.label),
      transactionLabels: undefined,
      walletName: walletNameMap.get(tx.walletId),
      isFrozen: state?.isFrozen ?? false,
      isLocked: state?.isLocked ?? false,
      lockedByDraftLabel: state?.lockedByDraftLabel,
    };
  });

  res.json(serializedTransactions);
}));

/**
 * GET /api/v1/transactions/pending
 * Get pending (unconfirmed) transactions across all wallets the user has access to
 * Used for mempool visualization showing user's transactions in the block queue
 *
 * Query params: none
 */
router.get('/transactions/pending', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;

  // Get all wallet IDs the user has access to
  const accessibleWallets = await walletRepository.findAccessibleWithSelect(
    userId,
    { id: true, name: true },
  );

  if (accessibleWallets.length === 0) {
    return res.json([]);
  }

  const walletIds = accessibleWallets.map(w => w.id);
  const walletNameMap = new Map(accessibleWallets.map(w => [w.id, w.name]));

  // Fetch pending (unconfirmed) transactions - those with blockHeight of 0 or null
  // Exclude replaced RBF transactions which are no longer in mempool
  const pendingTransactions = await transactionRepository.findByWalletIdsWithDetails(walletIds, {
    where: {
      rbfStatus: { not: 'replaced' },
      OR: [
        { blockHeight: 0 },
        { blockHeight: null },
      ],
    },
    select: {
      txid: true,
      walletId: true,
      type: true,
      amount: true,
      fee: true,
      rawTx: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Serialize and include fee rate (needed for mempool visualization)
  const serializedPending = pendingTransactions.map(tx => {
    const fee = bigIntToNumber(tx.fee) || 0;
    // Calculate size from rawTx hex (2 hex chars = 1 byte), or estimate ~200 bytes
    const size = tx.rawTx ? Math.ceil(tx.rawTx.length / 2) : 200;
    const feeRate = size > 0 ? fee / size : 0;

    return {
      txid: tx.txid,
      walletId: tx.walletId,
      walletName: walletNameMap.get(tx.walletId),
      type: tx.type,
      amount: bigIntToNumberOrZero(tx.amount),
      fee,
      size,
      feeRate: Math.round(feeRate * 100) / 100, // 2 decimal places
      createdAt: tx.createdAt,
    };
  });

  // Sort by fee rate descending (higher fee rate first)
  serializedPending.sort((a, b) => b.feeRate - a.feeRate);

  res.json(serializedPending);
}));

/**
 * GET /api/v1/transactions/balance-history
 * Get balance history chart data across all wallets the user has access to
 * This is an optimized aggregate endpoint that replaces N separate API calls
 *
 * Query params:
 * - timeframe: '1D' | '1W' | '1M' | '1Y' | 'ALL' (default: '1W')
 * - totalBalance: current total balance in satoshis (required for chart calculation)
 * - walletIds: comma-separated list of wallet IDs to filter (optional)
 */
router.get('/transactions/balance-history', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const timeframe = (req.query.timeframe as string) || '1W';
  /* v8 ignore next -- schema catch provides default for malformed query input */
  const totalBalance = TotalBalanceSchema.safeParse(req.query.totalBalance).data ?? 0;
  const requestedWalletIds = req.query.walletIds
    ? (req.query.walletIds as string).split(',').filter(Boolean)
    : null;

  // Get all wallet IDs the user has access to
  const accessibleWallets = await walletRepository.findAccessibleWithSelect(
    userId,
    { id: true },
    requestedWalletIds ? { id: { in: requestedWalletIds } } : undefined,
  );

  if (accessibleWallets.length === 0) {
    return res.json([
      { name: 'Start', value: totalBalance },
      { name: 'Now', value: totalBalance },
    ]);
  }

  const walletIds = accessibleWallets.map(w => w.id);
  const startDate = getTimeframeStartDate(timeframe);

  const bucketConfig = getBucketConfig(timeframe);
  const bucketed = await transactionRepository.getBucketedBalanceDeltas(walletIds, startDate, bucketConfig.unit);

  if (bucketed.length === 0) {
    // No transactions in range - return flat line
    return res.json([
      { name: 'Start', value: totalBalance },
      { name: 'Now', value: totalBalance },
    ]);
  }

  // Calculate running balance backwards from current total
  let runningBalance = totalBalance;
  const chartData: { name: string; value: number }[] = [];

  // Start with current balance
  chartData.push({ name: 'Now', value: totalBalance });

  // Work backwards through bucketed deltas to reconstruct history
  // Buckets are sorted oldest first, so reverse iterate
  for (let i = bucketed.length - 1; i >= 0; i--) {
    const bucket = bucketed[i];
    const amount = bigIntToNumberOrZero(bucket.amount);
    // Subtract the bucket net amount to get balance before
    runningBalance -= amount;
    chartData.unshift({
      name: bucketConfig.label(new Date(bucket.bucket)),
      value: runningBalance,
    });
  }

  res.json(chartData);
}));

/**
 * GET /api/v1/transactions/activity-summary
 * Headline activity figures across all wallets the user can access, for the
 * selected dashboard period.
 *
 * Exists because /transactions/recent returns a page and never counts the whole
 * set — the dashboard's collapsed Recent Activity bar needs a real total, and
 * deriving one from a page would be an invented number.
 *
 * Query params:
 * - timeframe: '1D' | '1W' | '1M' | '1Y' | 'ALL' (default: '1W')
 * - walletIds: comma-separated list of wallet IDs to filter (optional)
 */
router.get('/transactions/activity-summary', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  /* v8 ignore next -- schema catch provides default for malformed query input */
  const timeframe = TimeframeSchema.safeParse(req.query.timeframe ?? '1W').data ?? '1W';
  const requestedWalletIds = parseRequestedWalletIds(req.query.walletIds);

  // Scoped by the repository, which ANDs the caller's id filter with the
  // user's access clause. Everything below aggregates over the wallets this
  // query returns, never over `requestedWalletIds` — asking for someone else's
  // wallet drops it silently rather than leaking or erroring.
  const accessibleWallets = await walletRepository.findAccessibleWithSelect(
    userId,
    { id: true },
    requestedWalletIds ? { id: { in: requestedWalletIds } } : undefined,
  );

  if (accessibleWallets.length === 0) {
    return res.json({ count: 0, receivedSats: 0, sentSats: 0, latestAt: null });
  }

  const walletIds = accessibleWallets.map(w => w.id);
  // Sorted so two requests covering the same wallets share a cache entry
  // regardless of the order the client happened to list them in.
  const cacheKey = `activity-summary:${userId}:${timeframe}:${[...walletIds].sort().join(',')}`;

  // Best-effort: a cache fault must not take down a read endpoint that does
  // not need the cache to answer correctly.
  let summary = await walletCache.get<ActivitySummaryPayload>(cacheKey).catch(() => null);

  if (!summary) {
    const startDate = getTimeframeStartDate(timeframe);
    const grouped = await transactionRepository.groupActivityByType(walletIds, startDate);

    let count = 0;
    let received = BigInt(0);
    let sent = BigInt(0);
    let latestAt: Date | null = null;

    for (const group of grouped) {
      count += group._count.id;

      // Both legs are reported as positive magnitudes and never netted. A
      // single signed total renders a period that received and spent the same
      // amount as "nothing happened" — the same reasoning the dashboard's
      // pending totals already follow.
      const amount = group._sum.amount ?? BigInt(0);
      const magnitude = amount < BigInt(0) ? -amount : amount;
      if (group.type === 'received') {
        received += magnitude;
      } else if (group.type === 'sent') {
        sent += magnitude;
      }

      const groupLatest = group._max.blockTime;
      if (groupLatest && (latestAt === null || groupLatest > latestAt)) {
        latestAt = groupLatest;
      }
    }

    summary = {
      count,
      receivedSats: bigIntToNumberOrZero(received),
      sentSats: bigIntToNumberOrZero(sent),
      latestAt: latestAt ? latestAt.toISOString() : null,
    };

    // Same 30s TTL as the per-wallet stats endpoint, and cleared outright by
    // invalidateWalletCaches on any wallet event — the TTL is a backstop, not
    // the freshness guarantee. Best-effort for the same reason as the read: a
    // failed write must not discard a correct response.
    await walletCache.set(cacheKey, summary, 30).catch(() => undefined);
  }

  res.json(summary);
}));

export default router;
