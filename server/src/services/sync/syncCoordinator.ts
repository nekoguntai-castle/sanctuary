import { walletRepository } from '../../repositories';
import { BITCOIN_NON_REGTEST_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import { DEFAULT_SYNC_PRIORITY, type SyncPriority } from '@sanctuary/shared/constants/sync';
import type { NetworkType } from '../../repositories/types';
import { NotFoundError, InvalidInputError, ServiceUnavailableError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import * as blockchain from '../bitcoin/blockchain';

const log = createLogger('SYNC:COORDINATOR');

const SYNC_NETWORKS = BITCOIN_NON_REGTEST_NETWORKS;

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
  status: 'accepted' | 'deduplicated';
  walletId: string;
}

export interface QueueNetworkSyncResponse {
  success: true;
  queued: number;
  walletIds: string[];
  message?: string;
}

export interface ResyncNetworkResponse extends QueueNetworkSyncResponse {
  acceptedWalletIds: string[];
  deduplicatedWalletIds: string[];
  rejectedWallets: Array<{
    walletId: string;
    reason: 'queue_unavailable' | 'queue_error';
  }>;
  indeterminateWallets: Array<{
    walletId: string;
    reason: 'queue_state_unknown';
  }>;
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
    throw new InvalidInputError('Invalid network. Must be mainnet, testnet3, testnet4, or signet.');
  }

  return network as SyncNetwork;
}

const walletCountLabel = (count: number): string => (
  `${count} wallet${count === 1 ? '' : 's'}`
);

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
    priority: SyncPriority = DEFAULT_SYNC_PRIORITY
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

  async queueUserWallets(userId: string, priority: SyncPriority = DEFAULT_SYNC_PRIORITY): Promise<QueueUserWalletsResponse> {
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

    const { enqueueFullResyncBatch } = await import('../workerSyncQueue');
    const result = await enqueueFullResyncBatch([walletId], {
      reason: `manual-wallet-resync:${userId}`,
    });
    const status = result.acceptedWalletIds.length > 0
      ? 'accepted'
      : result.deduplicatedWalletIds.length > 0
        ? 'deduplicated'
        : null;
    if (!status) {
      throw new ServiceUnavailableError(
        result.indeterminateWallets.length > 0
          ? 'Full resync queue state could not be confirmed'
          : 'Full resync queue is unavailable',
        undefined,
        { outcomes: result.outcomes },
      );
    }

    return {
      success: true,
      message: status === 'accepted'
        ? 'Full resync queued. Wallet data will be reset after exclusive sync ownership is acquired.'
        : 'A full resync is already queued for this wallet.',
      status,
      walletId,
    };
  }

  async queueNetworkSync(
    userId: string,
    network: string,
    priority: SyncPriority = DEFAULT_SYNC_PRIORITY
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
        acceptedWalletIds: [],
        deduplicatedWalletIds: [],
        rejectedWallets: [],
        indeterminateWallets: [],
        message: `No ${syncNetwork} wallets found`,
      };
    }

    const walletIds = wallets.map(w => w.id);
    const [{ enqueueFullResyncBatch }, staggerDelayMs] = await Promise.all([
      import('../workerSyncQueue'),
      getSyncStaggerDelayMs(),
    ]);
    const result = await enqueueFullResyncBatch(walletIds, {
      reason: `manual-network-resync:${syncNetwork}`,
      staggerDelayMs,
    });
    const queuedWalletIds = result.outcomes
      .filter(outcome => outcome.status === 'accepted' || outcome.status === 'deduplicated')
      .map(outcome => outcome.walletId);
    if (queuedWalletIds.length === 0) {
      throw new ServiceUnavailableError(
        'Full resync queue is unavailable or could not be confirmed',
        undefined,
        { outcomes: result.outcomes },
      );
    }

    return {
      success: true,
      queued: result.acceptedWalletIds.length,
      walletIds: queuedWalletIds,
      acceptedWalletIds: result.acceptedWalletIds,
      deduplicatedWalletIds: result.deduplicatedWalletIds,
      rejectedWallets: result.rejectedWallets,
      indeterminateWallets: result.indeterminateWallets,
      message: [
        `Queued ${walletCountLabel(result.acceptedWalletIds.length)}`,
        `${walletCountLabel(result.deduplicatedWalletIds.length)} already queued`,
        ...(result.rejectedWallets.length > 0
          ? [`${walletCountLabel(result.rejectedWallets.length)} rejected`]
          : []),
        ...(result.indeterminateWallets.length > 0
          ? [`${walletCountLabel(result.indeterminateWallets.length)} queue state unknown`]
          : []),
      ].join('; ') + '.',
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
