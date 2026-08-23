import { addressRepository, walletRepository } from '../../repositories';
import { BITCOIN_NON_REGTEST_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import { DEFAULT_SYNC_PRIORITY, type SyncPriority } from '@sanctuary/shared/constants/sync';
import type { NetworkType } from '../../repositories/types';
import {
  NotFoundError,
  InvalidInputError,
  ServiceUnavailableError,
  SyncInProgressError,
} from '../../errors/ApiError';
import {
  ConfirmationLockUnavailableError,
  ConfirmationRefreshError,
  refreshWalletConfirmations,
} from './confirmationUpdater';
import { syncLifecyclePublisher } from './syncLifecyclePublisher';
import type { ConfirmationUpdate } from '../bitcoin/blockchain';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import {
  syncIntentAdmission,
  type IncrementalSyncAdmissionResult,
  type IncrementalSyncWakeupDisposition,
} from './syncIntentAdmission';

const SYNC_NETWORKS = BITCOIN_NON_REGTEST_NETWORKS;
const SYNC_ADMISSION_BATCH_CONCURRENCY = 5;
const log = createLogger('SYNC:COORDINATOR');

type SyncNetwork = Extract<NetworkType, (typeof SYNC_NETWORKS)[number]>;

export interface WalletSyncResponse {
  success: true;
  status: 'requested' | 'merged';
  generation: number;
  wakeup: IncrementalSyncWakeupDisposition;
  message: string;
}

export type QueuedWalletSyncResponse = WalletSyncResponse;

export interface QueueUserWalletsResponse {
  success: true;
  requested: number;
  merged: number;
  rejected: number;
  indeterminate: number;
  outcomes: WalletSyncBatchOutcome[];
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
  generation: number;
  incrementalGeneration: number;
  wakeup: 'enqueued' | 'unavailable';
}

export interface QueueNetworkSyncResponse {
  success: true;
  requested: number;
  merged: number;
  rejected: number;
  indeterminate: number;
  walletIds: string[];
  outcomes: WalletSyncBatchOutcome[];
  message?: string;
}

export type WalletSyncBatchOutcome = {
  walletId: string;
  status: 'requested' | 'merged';
  generation: number;
  wakeup: IncrementalSyncWakeupDisposition;
} | {
  walletId: string;
  status: 'rejected';
  reason: 'blocked' | 'generation_exhausted' | 'not_found';
} | {
  walletId: string;
  status: 'indeterminate';
  reason: 'admission_error';
};

export interface ResyncNetworkResponse {
  success: true;
  queued: number;
  walletIds: string[];
  message?: string;
  acceptedWalletIds: string[];
  deduplicatedWalletIds: string[];
  deferredWalletIds: string[];
  rejectedWallets: Array<{
    walletId: string;
    reason: 'queue_unavailable' | 'queue_error';
  }>;
  indeterminateWallets: Array<{
    walletId: string;
    reason: 'queue_state_unknown';
  }>;
  /** Wallets the user owns that no network resync can reach. */
  excludedWallets: ExcludedWallet[];
}

export interface ExcludedWallet {
  walletId: string;
  reason: 'network_not_syncable';
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

type NetworkWalletSyncState = Awaited<
ReturnType<typeof walletRepository.findByNetworkWithSyncStatus>
>[number];

function hasDurablePendingSync(wallet: NetworkWalletSyncState): boolean {
  return wallet.requestedIncrementalSyncGeneration
      > wallet.processedIncrementalSyncGeneration
    || wallet.requestedFullResyncGeneration
      > wallet.processedFullResyncGeneration;
}

function isNetworkSyncFailed(wallet: NetworkWalletSyncState): boolean {
  if (wallet.syncInProgress) return false;
  if (wallet.syncActionRequiredAt !== null) return true;
  return !hasDurablePendingSync(wallet) && wallet.lastSyncStatus === 'failed';
}

function isNetworkSyncPending(wallet: NetworkWalletSyncState): boolean {
  return !wallet.syncInProgress
    && wallet.syncActionRequiredAt === null
    && (hasDurablePendingSync(wallet) || wallet.lastSyncStatus === null);
}

function isNetworkSyncCurrent(wallet: NetworkWalletSyncState): boolean {
  return !wallet.syncInProgress
    && wallet.syncActionRequiredAt === null
    && !hasDurablePendingSync(wallet)
    && wallet.lastSyncStatus === 'success';
}

export type LegacyWalletSyncResponse = WalletSyncResponse;

export interface UpdateConfirmationsResponse {
  message: string;
  updated: ConfirmationUpdate[];
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

/**
 * Wallets the user can see but no network resync can ever reach, because their
 * network is outside the syncable set. They are absent from every batch rather
 * than rejected by one, so a queued count alone silently omits them.
 */
async function findWalletsExcludedFromSync(userId: string): Promise<ExcludedWallet[]> {
  const wallets = await walletRepository.findAccessibleWithSelect(
    userId,
    { id: true },
    { network: { notIn: [...SYNC_NETWORKS] } },
  );

  return wallets.map(({ id }) => ({ walletId: id, reason: 'network_not_syncable' as const }));
}

async function getSyncServiceInstance() {
  const { getSyncService } = await import('./syncService');
  return getSyncService();
}

type IncrementalSyncAdmissionFailure = Exclude<
  IncrementalSyncAdmissionResult,
  { status: 'requested' | 'merged' }
>;

function admissionFailure(result: IncrementalSyncAdmissionFailure): never {
  if (result.status === 'not_found') throw new NotFoundError('Wallet not found');
  throw new ServiceUnavailableError(result.status === 'generation_exhausted'
    ? 'Wallet sync generation limit reached'
    : 'Wallet sync is temporarily unavailable');
}

async function requestWalletHistory(walletId: string): Promise<WalletSyncResponse> {
  const result = await syncIntentAdmission.request(walletId, { mode: 'explicit_reopen' });
  if (!('generation' in result)) {
    return admissionFailure(result);
  }
  return {
    success: true,
    status: result.status,
    generation: result.generation,
    wakeup: result.wakeup,
    message: result.status === 'requested'
      ? 'Wallet sync requested'
      : 'Wallet sync merged with existing work',
  };
}

async function requestWalletHistoryBatch(walletIds: string[]): Promise<WalletSyncBatchOutcome[]> {
  const outcomes: WalletSyncBatchOutcome[] = [];
  for (let offset = 0; offset < walletIds.length; offset += SYNC_ADMISSION_BATCH_CONCURRENCY) {
    const page = walletIds.slice(offset, offset + SYNC_ADMISSION_BATCH_CONCURRENCY);
    const pageOutcomes = await Promise.all(page.map(async walletId => {
      try {
        const result = await syncIntentAdmission.request(walletId, { mode: 'explicit_reopen' });
        if (result.status === 'requested' || result.status === 'merged') {
          return {
            walletId,
            status: result.status,
            generation: result.generation,
            wakeup: result.wakeup,
          };
        }
        return {
          walletId,
          status: 'rejected' as const,
          reason: result.status,
        };
      } catch (error) {
        log.error('Wallet sync batch admission failed with unknown durable outcome', {
          walletId,
          error: getErrorMessage(error),
        });
        return { walletId, status: 'indeterminate' as const, reason: 'admission_error' as const };
      }
    }));
    outcomes.push(...pageOutcomes);
  }
  return outcomes;
}

function countBatchStatus(outcomes: WalletSyncBatchOutcome[], status: WalletSyncBatchOutcome['status']): number {
  return outcomes.filter(outcome => outcome.status === status).length;
}

type FullResyncBatchOutcome =
  | {
    walletId: string;
    status: 'requested' | 'merged';
    generation: number;
    incrementalGeneration: number;
    wakeup: 'enqueued' | 'unavailable';
  }
  | { walletId: string; status: 'rejected'; reason: 'queue_unavailable' | 'queue_error' }
  | { walletId: string; status: 'indeterminate'; reason: 'queue_state_unknown' };

async function requestFullResyncBatch(
  walletIds: string[],
  reason: string,
): Promise<FullResyncBatchOutcome[]> {
  const outcomes: FullResyncBatchOutcome[] = [];
  for (let offset = 0; offset < walletIds.length; offset += SYNC_ADMISSION_BATCH_CONCURRENCY) {
    const page = walletIds.slice(offset, offset + SYNC_ADMISSION_BATCH_CONCURRENCY);
    const pageOutcomes = await Promise.all(page.map(async walletId => {
      try {
        const result = await syncIntentAdmission.requestFullResync(walletId, { reason });
        if (result.status === 'requested' || result.status === 'merged') {
          return {
            walletId,
            status: result.status,
            generation: result.generation,
            incrementalGeneration: result.incrementalGeneration,
            wakeup: result.wakeup,
          };
        }
        return {
          walletId,
          status: 'rejected' as const,
          reason: result.status === 'blocked' ? 'queue_unavailable' as const : 'queue_error' as const,
        };
      } catch (error) {
        log.error('Full-resync batch admission failed with unknown durable outcome', {
          walletId,
          error: getErrorMessage(error),
        });
        return {
          walletId,
          status: 'indeterminate' as const,
          reason: 'queue_state_unknown' as const,
        };
      }
    }));
    outcomes.push(...pageOutcomes);
  }
  return outcomes;
}

export class SyncCoordinator {
  async syncWalletNow(userId: string, walletId: string): Promise<WalletSyncResponse> {
    await requireWalletAccess(walletId, userId);
    return requestWalletHistory(walletId);
  }

  async syncLegacyBitcoinWallet(userId: string, walletId: string): Promise<LegacyWalletSyncResponse> {
    await requireWalletAccess(walletId, userId);
    return requestWalletHistory(walletId);
  }

  async syncLegacyBitcoinAddress(userId: string, addressId: string): Promise<LegacyWalletSyncResponse> {
    const address = await addressRepository.findByIdWithAccess(addressId, userId);
    if (!address) throw new NotFoundError('Address not found');
    return requestWalletHistory(address.walletId);
  }

  async updateWalletConfirmations(userId: string, walletId: string): Promise<UpdateConfirmationsResponse> {
    await requireWalletAccess(walletId, userId);

    let result;
    try {
      result = await refreshWalletConfirmations(walletId);
    } catch (error) {
      if (
        error instanceof ConfirmationRefreshError
        && error.cause instanceof ConfirmationLockUnavailableError
      ) {
        throw new SyncInProgressError(walletId);
      }
      throw error;
    }

    return {
      message: 'Confirmations updated',
      updated: result.confirmationUpdates,
    };
  }

  async queueWalletSync(
    userId: string,
    walletId: string,
    priority: SyncPriority = DEFAULT_SYNC_PRIORITY
  ): Promise<QueuedWalletSyncResponse> {
    await requireWalletAccess(walletId, userId);
    void priority;
    return requestWalletHistory(walletId);
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
    void priority;
    const wallets = await walletRepository.findByUserId(userId);
    const outcomes = await requestWalletHistoryBatch(wallets.map(wallet => wallet.id));
    return {
      success: true,
      requested: outcomes.filter(outcome => outcome.status === 'requested').length,
      merged: outcomes.filter(outcome => outcome.status === 'merged').length,
      rejected: countBatchStatus(outcomes, 'rejected'),
      indeterminate: countBatchStatus(outcomes, 'indeterminate'),
      outcomes,
    };
  }

  async resetWalletSyncState(userId: string, walletId: string): Promise<ResetWalletSyncResponse> {
    await requireWalletAccess(walletId, userId);
    const state = await syncIntentAdmission.reset(walletId);
    if (!state) throw new NotFoundError('Wallet not found');
    const transition = { walletId, transition: 'cleared' as const, state };
    await syncLifecyclePublisher.publish(transition);

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

    const result = await syncIntentAdmission.requestFullResync(walletId, {
      reason: `manual-wallet-resync:${userId}`,
    });
    if (!('generation' in result)) {
      if (result.status === 'not_found') throw new NotFoundError('Wallet not found');
      if (result.status === 'generation_exhausted') {
        throw new ServiceUnavailableError('Wallet full-resync generation limit reached');
      }
      throw new ServiceUnavailableError('Wallet sync is temporarily unavailable');
    }
    const status = result.status === 'requested' ? 'accepted' : 'deduplicated';

    return {
      success: true,
      message: result.wakeup === 'unavailable'
        ? 'Full resync requested durably; recovery will enqueue it when queue authority is available.'
        : status === 'accepted'
          ? 'Full resync queued. Wallet data will be reset after exclusive sync ownership is acquired.'
          : 'A full resync is already queued for this wallet.',
      status,
      walletId,
      generation: result.generation,
      incrementalGeneration: result.incrementalGeneration,
      wakeup: result.wakeup,
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
        requested: 0,
        merged: 0,
        rejected: 0,
        indeterminate: 0,
        walletIds: [],
        outcomes: [],
        message: `No ${syncNetwork} wallets found`,
      };
    }

    void priority;
    const outcomes = await requestWalletHistoryBatch(walletIds);

    return {
      success: true,
      requested: outcomes.filter(outcome => outcome.status === 'requested').length,
      merged: outcomes.filter(outcome => outcome.status === 'merged').length,
      rejected: countBatchStatus(outcomes, 'rejected'),
      indeterminate: countBatchStatus(outcomes, 'indeterminate'),
      walletIds,
      outcomes,
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

    const [wallets, excludedWallets] = await Promise.all([
      walletRepository.findByNetworkWithSyncStatus(userId, syncNetwork),
      findWalletsExcludedFromSync(userId),
    ]);
    const exclusionClause = excludedWallets.length > 0
      ? `${walletCountLabel(excludedWallets.length)} not on a syncable network`
      : null;

    if (wallets.length === 0) {
      return {
        success: true,
        queued: 0,
        walletIds: [],
        acceptedWalletIds: [],
        deduplicatedWalletIds: [],
        deferredWalletIds: [],
        rejectedWallets: [],
        indeterminateWallets: [],
        excludedWallets,
        message: exclusionClause
          ? `No ${syncNetwork} wallets found; ${exclusionClause}.`
          : `No ${syncNetwork} wallets found`,
      };
    }

    const outcomes = await requestFullResyncBatch(
      wallets.map(wallet => wallet.id),
      `manual-network-resync:${syncNetwork}`,
    );
    const acceptedWalletIds = outcomes
      .filter(outcome => outcome.status === 'requested')
      .map(outcome => outcome.walletId);
    const deduplicatedWalletIds = outcomes
      .filter(outcome => outcome.status === 'merged')
      .map(outcome => outcome.walletId);
    const queuedWalletIds = outcomes
      .filter(outcome => outcome.status === 'requested' && outcome.wakeup === 'enqueued')
      .map(outcome => outcome.walletId);
    const deferredWalletIds = outcomes
      .filter((outcome): outcome is Extract<FullResyncBatchOutcome, {
        status: 'requested' | 'merged';
      }> => outcome.status === 'requested' || outcome.status === 'merged')
      .filter(outcome => outcome.wakeup === 'unavailable')
      .map(outcome => outcome.walletId);
    const rejectedWallets = outcomes
      .filter((outcome): outcome is Extract<FullResyncBatchOutcome, { status: 'rejected' }> => (
        outcome.status === 'rejected'
      ))
      .map(({ walletId, reason }) => ({ walletId, reason }));
    const indeterminateWallets = outcomes
      .filter((outcome): outcome is Extract<FullResyncBatchOutcome, { status: 'indeterminate' }> => (
        outcome.status === 'indeterminate'
      ))
      .map(({ walletId, reason }) => ({ walletId, reason }));

    return {
      success: true,
      queued: queuedWalletIds.length,
      // Deduplicated wallets are reported in their own bucket: folding them in
      // here would claim work was queued for a wallet that may already be wedged
      // behind the retained job.
      walletIds: queuedWalletIds,
      acceptedWalletIds,
      deduplicatedWalletIds,
      deferredWalletIds,
      rejectedWallets,
      indeterminateWallets,
      excludedWallets,
      message: [
        `Queued ${walletCountLabel(queuedWalletIds.length)}`,
        `${walletCountLabel(deduplicatedWalletIds.length)} already requested`,
        ...(deferredWalletIds.length > 0
          ? [`${walletCountLabel(deferredWalletIds.length)} awaiting queue recovery`]
          : []),
        ...(rejectedWallets.length > 0
          ? [`${walletCountLabel(rejectedWallets.length)} rejected`]
          : []),
        ...(indeterminateWallets.length > 0
          ? [`${walletCountLabel(indeterminateWallets.length)} queue state unknown`]
          : []),
        ...(exclusionClause ? [exclusionClause] : []),
      ].join('; ') + '.',
    };
  }

  async getNetworkSyncStatus(userId: string, network: string): Promise<NetworkSyncStatusResponse> {
    const syncNetwork = parseSyncNetwork(network);
    const wallets = await walletRepository.findByNetworkWithSyncStatus(userId, syncNetwork);

    const syncing = wallets.filter(w => w.syncInProgress).length;
    const synced = wallets.filter(isNetworkSyncCurrent).length;
    const failed = wallets.filter(isNetworkSyncFailed).length;
    const pending = wallets.filter(isNetworkSyncPending).length;
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
