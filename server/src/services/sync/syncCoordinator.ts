import { walletRepository, transactionRepository, addressRepository } from '../../repositories';
import type { NetworkType } from '../../repositories/types';
import { NotFoundError, InvalidInputError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import * as blockchain from '../bitcoin/blockchain';

const log = createLogger('SYNC:COORDINATOR');

const SYNC_NETWORKS = ['mainnet', 'testnet', 'signet'] as const;

export type SyncPriority = 'high' | 'normal' | 'low';
type SyncNetwork = Extract<NetworkType, (typeof SYNC_NETWORKS)[number]>;

export interface WalletSyncResponse {
  success: boolean;
  syncedAddresses: number;
  newTransactions: number;
  newUtxos: number;
  error?: string;
}

export interface QueuedWalletSyncResponse {
  queued: true;
  queuePosition: number | null;
  syncInProgress: boolean;
}

export interface QueueUserWalletsResponse {
  success: true;
  message: string;
}

export interface ResetWalletSyncResponse {
  success: true;
  message: string;
}

export interface ResyncWalletResponse {
  success: true;
  message: string;
  deletedTransactions: number;
}

export interface QueueNetworkSyncResponse {
  success: true;
  queued: number;
  walletIds: string[];
  message?: string;
}

export interface ResyncNetworkResponse extends QueueNetworkSyncResponse {
  deletedTransactions?: number;
  clearedStuckFlags?: number;
}

export interface NetworkSyncStatusResponse {
  network: SyncNetwork;
  total: number;
  syncing: number;
  synced: number;
  failed: number;
  pending: number;
  lastSyncAt: string | null;
}

export interface LegacyWalletSyncResponse {
  message: string;
  [key: string]: unknown;
}

export interface UpdateConfirmationsResponse {
  message: string;
  updated: Awaited<ReturnType<typeof blockchain.updateTransactionConfirmations>>;
}

function parseSyncNetwork(network: string): SyncNetwork {
  if (!SYNC_NETWORKS.includes(network as SyncNetwork)) {
    throw new InvalidInputError('Invalid network. Must be mainnet, testnet, or signet.');
  }

  return network as SyncNetwork;
}

async function requireWalletAccess(walletId: string, userId: string): Promise<void> {
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }
}

async function getSyncStaggerDelayMs(): Promise<number> {
  const { getConfig } = await import('../../config');
  return getConfig().sync.syncStaggerDelayMs;
}

async function getSyncServiceInstance() {
  const { getSyncService } = await import('./syncService');
  return getSyncService();
}

export class SyncCoordinator {
  async syncWalletNow(userId: string, walletId: string): Promise<WalletSyncResponse> {
    await requireWalletAccess(walletId, userId);

    const syncService = await getSyncServiceInstance();
    const result = await syncService.syncNow(walletId);

    return {
      success: result.success,
      syncedAddresses: result.addresses,
      newTransactions: result.transactions,
      newUtxos: result.utxos,
      error: result.error,
    };
  }

  async syncLegacyBitcoinWallet(userId: string, walletId: string): Promise<LegacyWalletSyncResponse> {
    await requireWalletAccess(walletId, userId);

    const result = await blockchain.syncWallet(walletId);

    return {
      message: 'Wallet synced successfully',
      ...result,
    };
  }

  async updateWalletConfirmations(userId: string, walletId: string): Promise<UpdateConfirmationsResponse> {
    await requireWalletAccess(walletId, userId);

    const updated = await blockchain.updateTransactionConfirmations(walletId);

    return {
      message: 'Confirmations updated',
      updated,
    };
  }

  async queueWalletSync(
    userId: string,
    walletId: string,
    priority: SyncPriority = 'normal'
  ): Promise<QueuedWalletSyncResponse> {
    await requireWalletAccess(walletId, userId);

    const syncService = await getSyncServiceInstance();
    syncService.queueSync(walletId, priority);

    const status = await syncService.getSyncStatus(walletId);

    return {
      queued: true,
      queuePosition: status.queuePosition,
      syncInProgress: status.syncInProgress,
    };
  }

  async getWalletSyncStatus(userId: string, walletId: string) {
    await requireWalletAccess(walletId, userId);

    const syncService = await getSyncServiceInstance();
    return syncService.getSyncStatus(walletId);
  }

  async getWalletSyncLogs(userId: string, walletId: string): Promise<{ logs: unknown[] }> {
    await requireWalletAccess(walletId, userId);

    const { walletLogBuffer } = await import('../walletLogBuffer');

    return {
      logs: walletLogBuffer.get(walletId),
    };
  }

  async queueUserWallets(userId: string, priority: SyncPriority = 'normal'): Promise<QueueUserWalletsResponse> {
    const syncService = await getSyncServiceInstance();
    await syncService.queueUserWallets(userId, priority);

    return {
      success: true,
      message: 'All wallets queued for sync',
    };
  }

  async resetWalletSyncState(userId: string, walletId: string): Promise<ResetWalletSyncResponse> {
    await requireWalletAccess(walletId, userId);
    await walletRepository.updateSyncState(walletId, { syncInProgress: false });

    return {
      success: true,
      message: 'Sync state reset',
    };
  }

  async resyncWallet(userId: string, walletId: string): Promise<ResyncWalletResponse> {
    const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    if (wallet.syncInProgress) {
      log.info(`[SYNC_API] Full resync clearing stuck syncInProgress for wallet ${walletId}`);
    }

    const deletedCount = await transactionRepository.deleteByWalletId(walletId);

    await addressRepository.resetUsedFlags(walletId);
    await walletRepository.resetSyncState(walletId);
    const syncService = await getSyncServiceInstance();
    syncService.queueSync(walletId, 'high');

    return {
      success: true,
      message: `Cleared ${deletedCount} transactions. Full resync queued.`,
      deletedTransactions: deletedCount,
    };
  }

  async queueNetworkSync(
    userId: string,
    network: string,
    priority: SyncPriority = 'normal'
  ): Promise<QueueNetworkSyncResponse> {
    const syncNetwork = parseSyncNetwork(network);
    const walletIds = await walletRepository.getIdsByNetwork(userId, syncNetwork);

    if (walletIds.length === 0) {
      return {
        success: true,
        queued: 0,
        walletIds: [],
        message: `No ${syncNetwork} wallets found`,
      };
    }

    const [{ enqueueWalletSyncBatch }, staggerDelayMs] = await Promise.all([
      import('../workerSyncQueue'),
      getSyncStaggerDelayMs(),
    ]);

    const queued = await enqueueWalletSyncBatch(walletIds, {
      priority,
      reason: `manual-network-sync:${syncNetwork}`,
      staggerDelayMs,
      jobIdPrefix: `manual-network-sync:${syncNetwork}:${userId}`,
    });

    return {
      success: true,
      queued,
      walletIds,
    };
  }

  async resyncNetwork(
    userId: string,
    network: string,
    confirmed: boolean
  ): Promise<ResyncNetworkResponse> {
    const syncNetwork = parseSyncNetwork(network);

    if (!confirmed) {
      throw new InvalidInputError('Full resync requires X-Confirm-Resync: true header');
    }

    const wallets = await walletRepository.findByNetworkWithSyncStatus(userId, syncNetwork);

    if (wallets.length === 0) {
      return {
        success: true,
        queued: 0,
        walletIds: [],
        message: `No ${syncNetwork} wallets found`,
      };
    }

    const stuckWallets = wallets.filter(w => w.syncInProgress);
    if (stuckWallets.length > 0) {
      log.info(`[SYNC_API] Full network resync clearing ${stuckWallets.length} stuck syncInProgress flags`);
    }

    const walletIds = wallets.map(w => w.id);
    let totalDeletedTxs = 0;

    for (const walletId of walletIds) {
      const deletedCount = await transactionRepository.deleteByWalletId(walletId);
      totalDeletedTxs += deletedCount;

      await addressRepository.resetUsedFlags(walletId);
      await walletRepository.resetSyncState(walletId);
    }

    const [{ enqueueWalletSyncBatch }, staggerDelayMs] = await Promise.all([
      import('../workerSyncQueue'),
      getSyncStaggerDelayMs(),
    ]);

    const queued = await enqueueWalletSyncBatch(walletIds, {
      priority: 'high',
      reason: `manual-network-resync:${syncNetwork}`,
      staggerDelayMs,
      jobIdPrefix: `manual-network-resync:${syncNetwork}:${userId}`,
    });

    return {
      success: true,
      queued,
      walletIds,
      deletedTransactions: totalDeletedTxs,
      clearedStuckFlags: stuckWallets.length,
    };
  }

  async getNetworkSyncStatus(userId: string, network: string): Promise<NetworkSyncStatusResponse> {
    const syncNetwork = parseSyncNetwork(network);
    const wallets = await walletRepository.findByNetworkWithSyncStatus(userId, syncNetwork);

    const syncing = wallets.filter(w => w.syncInProgress).length;
    const synced = wallets.filter(w => !w.syncInProgress && w.lastSyncStatus === 'success').length;
    const failed = wallets.filter(w => !w.syncInProgress && w.lastSyncStatus === 'failed').length;
    const pending = wallets.filter(w => !w.syncInProgress && !w.lastSyncStatus).length;
    const syncTimes = wallets
      .filter(w => w.lastSyncedAt)
      .map(w => new Date(w.lastSyncedAt!).getTime());
    const lastSyncAt = syncTimes.length > 0 ? new Date(Math.max(...syncTimes)).toISOString() : null;

    return {
      network: syncNetwork,
      total: wallets.length,
      syncing,
      synced,
      failed,
      pending,
      lastSyncAt,
    };
  }
}

let syncCoordinator: SyncCoordinator | null = null;

export function getSyncCoordinator(): SyncCoordinator {
  if (!syncCoordinator) {
    syncCoordinator = new SyncCoordinator();
  }

  return syncCoordinator;
}

/* v8 ignore next -- test-only singleton reset helper */
export function resetSyncCoordinatorForTests(): void {
  syncCoordinator = null;
}
