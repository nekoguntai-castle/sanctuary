/**
 * Wallets Collector
 *
 * Collects per-wallet diagnostic info with anonymized IDs.
 * Includes type, network, sync status, and counts — no addresses or xpubs.
 */

import { walletRepository } from '../../../repositories';
import { registerCollector } from './registry';
import type { CollectorContext } from '../types';

registerCollector('wallets', async (context: CollectorContext) => {
  const wallets = await walletRepository.findAllWithSelect({
    id: true,
    type: true,
    network: true,
    lastSyncStatus: true,
    lastSyncedAt: true,
    lastSyncError: true,
    syncInProgress: true,
    _count: {
      select: {
        addresses: true,
        transactions: true,
      },
    },
  });

  return {
    total: wallets.length,
    wallets: wallets.map(w => ({
      id: context.anonymize('wallet', w.id),
      type: w.type,
      network: w.network,
      lastSyncStatus: w.lastSyncStatus,
      lastSyncedAt: w.lastSyncedAt?.toISOString() ?? null,
      lastSyncError: w.lastSyncError,
      syncInProgress: w.syncInProgress,
      addressCount: w._count.addresses,
      transactionCount: w._count.transactions,
    })),
  };
});
