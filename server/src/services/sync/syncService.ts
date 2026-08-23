/**
 * Sync Service Compatibility Layer
 *
 * Preserves status, confirmation, and subscription behavior while wallet-history
 * producers use durable intent admission and the canonical worker consumer.
 * - Updates confirmations for pending transactions
 * - Notifies frontend via WebSocket when data changes
 */

import { walletRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getConfig } from '../../config';
import { releaseLock, withLock } from '../../infrastructure';
import { getWorkerHealthStatus } from '../workerHealth';
import { syncPollingModeTransitions } from '../../observability/metrics';
import type { SyncExecutionOwner, SyncPriority } from '@sanctuary/shared/constants/sync';
import type { SyncState, SyncResult, SyncHealthMetrics, PollingMode } from './types';
import { SubscriptionAuthorityRetryController } from './lockAuthorityRecovery';
import { classifyWalletSyncFailure } from './failureClassification';
import { clearStuckSyncIfAuthorized } from './staleWalletChecker';
import { refreshPendingConfirmations } from './confirmationUpdater';
import { syncIntentAdmission } from './syncIntentAdmission';
import {
  setupRealTimeSubscriptions as doSetupRealTimeSubscriptions,
  teardownRealTimeSubscriptions as doTeardownRealTimeSubscriptions,
  releaseSubscriptionLock as doReleaseSubscriptionLock,
  unsubscribeWalletAddresses as doUnsubscribeWalletAddresses,
  subscribeNewWalletAddresses as doSubscribeNewWalletAddresses,
  subscribeWalletAddresses as doSubscribeWalletAddresses,
  reconcileAddressToWalletMap as doReconcileAddressToWalletMap,
  subscribeAllWalletAddresses as doSubscribeAllWalletAddresses,
  handleNewBlock as doHandleNewBlock,
  handleAddressActivity as doHandleAddressActivity,
  startSubscriptionLockRefresh as doStartSubscriptionLockRefresh,
  stopSubscriptionLockRefresh as doStopSubscriptionLockRefresh,
} from './subscriptionManager';

const log = createLogger('SYNC:SVC');

class SyncService {
  private static instance: SyncService;
  private syncInterval: NodeJS.Timeout | null = null;
  private confirmationInterval: NodeJS.Timeout | null = null;
  // Periodic reconciliation interval for addressToWalletMap cleanup
  private reconciliationInterval: NodeJS.Timeout | null = null;
  // Polls worker health to dynamically start/stop in-process intervals
  private workerHealthPollTimer: NodeJS.Timeout | null = null;
  private readonly subscriptionAuthorityRetry: SubscriptionAuthorityRetryController;

  /**
   * Shared mutable state accessed by sub-modules.
   * Passed by reference so sub-modules can coordinate without circular dependencies.
   */
  private state: SyncState = {
    isRunning: false,
    syncQueue: [],
    activeSyncs: new Set(),
    activeLocks: new Map(),
    addressToWalletMap: new Map(),
    pendingRetries: new Map(),
    subscriptionLock: null,
    subscriptionLockRefresh: null,
    subscriptionsEnabled: false,
    subscriptionOwnership: 'disabled',
    subscribedToHeaders: false,
    pollingMode: 'in-process',
  };

  private constructor() {
    this.subscriptionAuthorityRetry = new SubscriptionAuthorityRetryController({
      isRunning: () => this.state.isRunning,
      getOwnership: () => this.state.subscriptionOwnership,
      setup: () => this.setupRealTimeSubscriptions(),
      teardown: () => this.teardownRealTimeSubscriptions(),
      release: () => this.releaseSubscriptionLock(),
    });
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  // ── Convenience accessors for test compatibility ─────────────────────
  // Tests access private fields via syncService['fieldName']; these getters
  // and setters keep that working while the actual state lives in this.state.

  get isRunning(): boolean { return this.state.isRunning; }
  set isRunning(v: boolean) { this.state.isRunning = v; }

  get activeSyncs(): typeof this.state.activeSyncs { return this.state.activeSyncs; }
  set activeSyncs(v: typeof this.state.activeSyncs) { this.state.activeSyncs = v; }

  get addressToWalletMap(): typeof this.state.addressToWalletMap { return this.state.addressToWalletMap; }
  set addressToWalletMap(v: typeof this.state.addressToWalletMap) { this.state.addressToWalletMap = v; }

  get subscriptionLock(): typeof this.state.subscriptionLock { return this.state.subscriptionLock; }
  set subscriptionLock(v: typeof this.state.subscriptionLock) { this.state.subscriptionLock = v; }

  get subscriptionLockRefresh(): typeof this.state.subscriptionLockRefresh { return this.state.subscriptionLockRefresh; }
  set subscriptionLockRefresh(v: typeof this.state.subscriptionLockRefresh) { this.state.subscriptionLockRefresh = v; }

  get subscriptionsEnabled(): boolean { return this.state.subscriptionsEnabled; }
  set subscriptionsEnabled(v: boolean) { this.state.subscriptionsEnabled = v; }

  get subscriptionOwnership(): typeof this.state.subscriptionOwnership { return this.state.subscriptionOwnership; }
  set subscriptionOwnership(v: typeof this.state.subscriptionOwnership) { this.state.subscriptionOwnership = v; }

  // subscribedToHeaders is only used internally via state; no external test access needed

  /**
   * Start the background sync service
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      log.info('[SYNC] Service already running');
      return;
    }

    log.info('[SYNC] Starting background sync service...');
    this.state.isRunning = true;

    // Reset any stuck syncInProgress flags from previous server sessions
    await this.resetStuckSyncs();

    // Get config values
    const syncConfig = getConfig().sync;
    this.state.subscriptionsEnabled = syncConfig.electrumSubscriptionsEnabled;

    // Decide initial polling mode based on worker health.
    // If the worker is healthy it owns stale-wallet checks and confirmation updates;
    // the API server only runs them when the worker is down.
    const workerHealthy = getWorkerHealthStatus().healthy;
    if (workerHealthy) {
      this.state.pollingMode = 'worker-delegated';
      log.info('[SYNC] Worker healthy — deferring polling to worker');
    } else {
      this.state.pollingMode = 'in-process';
      this.startPollingIntervals();
      log.info('[SYNC] Worker unhealthy — starting in-process polling');
    }

    // Set up real-time subscriptions (async, don't block startup)
    this.subscriptionAuthorityRetry.start();

    // Periodic reconciliation of addressToWalletMap (every hour)
    // Rebuilds map from database to clean up entries for deleted wallets
    // Always runs — worker has no in-memory address map
    // Uses distributed lock so only one API instance runs reconciliation at a time
    this.reconciliationInterval = setInterval(() => {
      withLock('sync:reconciliation', 5 * 60 * 1000, async () => {
        await this.reconcileAddressToWalletMap();
      }).then(result => {
        if (!result.success) {
          log.debug('[SYNC] Reconciliation skipped — another instance holds the lock');
        }
      }).catch(err => {
        log.error('[SYNC] Address map reconciliation failed', { error: getErrorMessage(err) });
      });
    }, 60 * 60 * 1000); // 1 hour
    this.reconciliationInterval.unref?.();

    // Poll worker health and start/stop intervals dynamically
    this.workerHealthPollTimer = setInterval(() => {
      this.evaluatePollingMode();
    }, syncConfig.workerHealthPollIntervalMs);
    this.workerHealthPollTimer.unref?.();

    log.info('[SYNC] Background sync service started', {
      pollingMode: this.state.pollingMode,
    });
  }

  /**
   * Stop the background sync service
   */
  async stop(): Promise<void> {
    log.info('[SYNC] Stopping background sync service...');
    this.state.isRunning = false;

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.confirmationInterval) {
      clearInterval(this.confirmationInterval);
      this.confirmationInterval = null;
    }

    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }

    if (this.workerHealthPollTimer) {
      clearInterval(this.workerHealthPollTimer);
      this.workerHealthPollTimer = null;
    }

    this.subscriptionAuthorityRetry.stop();

    await this.teardownRealTimeSubscriptions();
    await this.releaseSubscriptionLock();

    // Cancel all pending retry timers
    if (this.state.pendingRetries.size > 0) {
      log.info(`[SYNC] Cancelling ${this.state.pendingRetries.size} pending retry timers`);
      for (const timer of this.state.pendingRetries.values()) {
        clearTimeout(timer);
      }
      this.state.pendingRetries.clear();
    }

    // Release all active distributed locks
    if (this.state.activeLocks.size > 0) {
      log.info(`[SYNC] Releasing ${this.state.activeLocks.size} active sync locks`);
      for (const [walletId, lock] of this.state.activeLocks.entries()) {
        try {
          await releaseLock(lock);
        } catch (error) {
          log.warn(`[SYNC] Failed to release lock for wallet ${walletId}`, { error: getErrorMessage(error) });
        }
      }
      this.state.activeLocks.clear();
      this.state.activeSyncs.clear();
    }

    // Clear the sync queue
    if (this.state.syncQueue.length > 0) {
      log.info(`[SYNC] Clearing ${this.state.syncQueue.length} queued sync jobs`);
      this.state.syncQueue.length = 0;
    }

    this.state.subscriptionOwnership = this.state.subscriptionsEnabled ? 'external' : 'disabled';

    log.info('[SYNC] Background sync service stopped');
  }

  /**
   * Get health metrics for monitoring
   */
  getHealthMetrics(): SyncHealthMetrics {
    // Structured recovery now protects this durable flag with owner/start
    // metadata, distributed-lock authority, and a versioned CAS. It therefore
    // represents worker-owned attempts that cannot appear in local activeSyncs.
    return {
      isRunning: this.state.isRunning,
      queueLength: this.state.syncQueue.length,
      activeSyncs: this.state.activeSyncs.size,
      subscribedAddresses: this.state.addressToWalletMap.size,
      subscriptionsEnabled: this.state.subscriptionsEnabled,
      subscriptionOwnership: this.state.subscriptionOwnership,
      pollingMode: this.state.pollingMode,
    };
  }

  /** @deprecated Inline queueing is retired; use syncIntentAdmission. */
  queueSync(_walletId: string, _priority?: SyncPriority): never {
    throw new Error('Inline wallet sync queue is retired; use durable sync intent admission');
  }

  /**
   * Get sync status for a wallet
   */
  async getSyncStatus(walletId: string): Promise<{
    lastSyncedAt: Date | null;
    syncStatus: string | null;
    syncInProgress: boolean;
    isStale: boolean;
    queuePosition: number | null;
    executionOwner: SyncExecutionOwner | null;
    retryCount: number;
    nextRetryAt: Date | null;
    startedAt: Date | null;
    stateVersion: number;
    requestedIncrementalSyncGeneration: number;
    claimedIncrementalSyncGeneration: number;
    processedIncrementalSyncGeneration: number;
    incrementalSyncClaimedAt: Date | null;
    incrementalSyncLeaseExpiresAt: Date | null;
    syncActionRequiredAt: Date | null;
    requestedFullResyncGeneration: number;
    preparedFullResyncGeneration: number;
    processedFullResyncGeneration: number;
  }> {
    const wallet = await walletRepository.findSyncState(walletId);

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const { staleThresholdMs } = getConfig().sync;
    const isStale = !wallet.lastSyncedAt ||
      (Date.now() - wallet.lastSyncedAt.getTime()) > staleThresholdMs;

    return {
      lastSyncedAt: wallet.lastSyncedAt,
      syncStatus: wallet.lastSyncStatus,
      syncInProgress: wallet.syncInProgress,
      isStale,
      // The in-process queue is retired; durable generations are authoritative.
      queuePosition: null,
      executionOwner: wallet.syncExecutionOwner,
      retryCount: wallet.syncRetryCount,
      nextRetryAt: wallet.syncNextRetryAt,
      startedAt: wallet.syncStartedAt,
      stateVersion: wallet.syncStateVersion,
      requestedIncrementalSyncGeneration: wallet.requestedIncrementalSyncGeneration,
      claimedIncrementalSyncGeneration: wallet.claimedIncrementalSyncGeneration,
      processedIncrementalSyncGeneration: wallet.processedIncrementalSyncGeneration,
      incrementalSyncClaimedAt: wallet.incrementalSyncClaimedAt,
      incrementalSyncLeaseExpiresAt: wallet.incrementalSyncLeaseExpiresAt,
      syncActionRequiredAt: wallet.syncActionRequiredAt,
      requestedFullResyncGeneration: wallet.requestedFullResyncGeneration,
      preparedFullResyncGeneration: wallet.preparedFullResyncGeneration,
      processedFullResyncGeneration: wallet.processedFullResyncGeneration,
    };
  }

  /** @deprecated Immediate inline execution is retired; use syncIntentAdmission. */
  async syncNow(_walletId: string): Promise<SyncResult> {
    throw new Error('Immediate wallet sync is retired; use durable sync intent admission');
  }

  /**
   * Unsubscribe all addresses for a wallet (call when wallet is deleted).
   * Prevents memory leak by cleaning up the addressToWalletMap.
   */
  async unsubscribeWalletAddresses(walletId: string): Promise<void> {
    return doUnsubscribeWalletAddresses(this.state, walletId);
  }

  /**
   * Subscribe to new addresses for a wallet (called when wallet is created/imported).
   */
  async subscribeNewWalletAddresses(walletId: string): Promise<void> {
    return doSubscribeNewWalletAddresses(this.state, walletId);
  }

  /**
   * Subscribe to Electrum address notifications for a wallet.
   * This enables real-time updates when transactions are received.
   */
  async subscribeWalletAddresses(walletId: string): Promise<void> {
    return doSubscribeWalletAddresses(walletId);
  }

  private async setupRealTimeSubscriptions(): Promise<void> {
    return doSetupRealTimeSubscriptions(
      this.state,
      (walletId) => this.requestAddressActivitySync(walletId),
      () => this.updateAllConfirmations(),
    );
  }

  private requestAddressActivitySync(walletId: string): void {
    syncIntentAdmission.request(walletId).then(result => {
      if (result.status === 'blocked'
        || (('wakeup' in result) && result.wakeup === 'unavailable')) {
        log.warn('[SYNC] Address activity wake-up deferred to recovery', {
          walletId,
          status: result.status,
        });
      }
    }).catch(error => {
      log.error('[SYNC] Failed to persist address activity sync intent', {
        walletId,
        error: getErrorMessage(error),
      });
    });
  }

  private async teardownRealTimeSubscriptions(): Promise<void> {
    return doTeardownRealTimeSubscriptions(this.state);
  }

  private async releaseSubscriptionLock(): Promise<void> {
    return doReleaseSubscriptionLock(this.state);
  }

  /** @deprecated Inline execution locks are owned only by the canonical worker. */
  public async acquireSyncLock(_walletId: string): Promise<boolean> {
    return false;
  }

  public async subscribeAllWalletAddresses(): Promise<void> {
    return doSubscribeAllWalletAddresses(this.state);
  }

  private async reconcileAddressToWalletMap(): Promise<void> {
    return doReconcileAddressToWalletMap(this.state);
  }

  public async handleNewBlock(block: { height: number; hex: string }): Promise<void> {
    return doHandleNewBlock(this.state, block, () => this.updateAllConfirmations());
  }

  public async handleAddressActivity(activity: { scriptHash: string; address?: string; status: string }): Promise<void> {
    return doHandleAddressActivity(
      this.state,
      activity,
      (walletId) => this.requestAddressActivitySync(walletId),
    );
  }

  public startSubscriptionLockRefresh(): void {
    doStartSubscriptionLockRefresh(
      this.state,
      /* v8 ignore next -- delegate callback; confirmation refresh behavior is covered separately */
      () => this.updateAllConfirmations(),
      () => this.teardownRealTimeSubscriptions(),
    );
  }

  public stopSubscriptionLockRefresh(): void {
    doStopSubscriptionLockRefresh(this.state);
  }

  /**
   * Start in-process polling intervals (stale wallet checks + confirmation updates).
   * Guarded against double-start.
   */
  private startPollingIntervals(): void {
    if (this.syncInterval) return; // already running

    const syncConfig = getConfig().sync;

    this.syncInterval = setInterval(() => {
      this.checkAndQueueStaleSyncs();
    }, syncConfig.intervalMs);

    this.confirmationInterval = setInterval(() => {
      this.updateAllConfirmations();
    }, syncConfig.confirmationUpdateIntervalMs);

    const previousMode = this.state.pollingMode;
    this.state.pollingMode = 'in-process';
    if (previousMode !== 'in-process') {
      syncPollingModeTransitions.inc({ from: previousMode, to: 'in-process' });
    }
    log.warn('[SYNC] Worker unhealthy — in-process polling intervals started');
  }

  /**
   * Stop in-process polling intervals (worker is handling them).
   */
  private stopPollingIntervals(): void {
    /* v8 ignore next -- interval clearing is exercised indirectly; null branch is the steady-state path */
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    /* v8 ignore next -- interval clearing is exercised indirectly; null branch is the steady-state path */
    if (this.confirmationInterval) {
      clearInterval(this.confirmationInterval);
      this.confirmationInterval = null;
    }

    const previousMode = this.state.pollingMode;
    this.state.pollingMode = 'worker-delegated';
    /* v8 ignore next -- transition metric guard is a defensive duplicate-transition no-op */
    if (previousMode !== 'worker-delegated') {
      syncPollingModeTransitions.inc({ from: previousMode, to: 'worker-delegated' });
    }
    log.info('[SYNC] Worker recovered — polling delegated to worker');
  }

  /**
   * Re-evaluate whether to run sync/confirmation intervals in-process
   * based on the current worker health status.
   */
  private evaluatePollingMode(): void {
    if (!this.state.isRunning) return;

    const workerHealthy = getWorkerHealthStatus().healthy;
    const currentMode: PollingMode = this.state.pollingMode;

    if (workerHealthy && currentMode === 'in-process') {
      // Worker recovered — hand off polling
      this.stopPollingIntervals();
    } else if (!workerHealthy && currentMode === 'worker-delegated') {
      // Worker went down — take over polling
      this.startPollingIntervals();
    }
  }

  /**
   * Reset any wallets that have syncInProgress stuck as true.
   * This happens if the server was restarted during a sync.
   */
  private async resetStuckSyncs(): Promise<void> {
    try {
      const count = await walletRepository.resetAllStuckSyncFlags();
      if (count > 0) {
        log.info(`[SYNC] Reset ${count} stuck sync flags from previous session`);
      }
    } catch (error) {
      log.error('[SYNC] Failed to reset stuck sync flags', { error: getErrorMessage(error) });
    }

    // The retry ladder is an in-heap timer, so this restart just discarded every
    // pending retry. A row left at 'retrying' is selected by no reaper and shows
    // "Retrying" over work nothing is doing; demoting it to 'failed' both tells
    // the truth and returns the wallet to findStale's population.
    try {
      const reason = 'Sync retry was interrupted by a restart and did not resume';
      const demoted = await walletRepository.demoteStrandedInlineRetries(
        reason,
        classifyWalletSyncFailure(reason),
      );
      if (demoted > 0) {
        log.warn(`[SYNC] Demoted ${demoted} wallets stranded mid-retry to failed`);
      }
    } catch (error) {
      log.error('[SYNC] Failed to demote stranded retries', { error: getErrorMessage(error) });
    }
  }

  /**
   * Repair legacy stuck inline markers while the compatibility service remains.
   * Elapsed wall-clock age must never request wallet-history work.
   */
  private async checkAndQueueStaleSyncs(): Promise<void> {
    if (!this.state.isRunning) return;

    try {
      // First, check for stuck syncs - wallets marked as syncing in DB but not in memory
      // This can happen if sync times out or crashes without proper cleanup
      const stuckWallets = await walletRepository.findStuckSyncing();

      // Reset any wallet that's marked as syncing but isn't actually syncing
      let unstuckCount = 0;
      for (const wallet of stuckWallets) {
        if (await clearStuckSyncIfAuthorized(wallet, this.state.activeSyncs)) {
          log.warn(`[SYNC] Auto-unstuck wallet ${wallet.name || wallet.id} (was stuck with syncInProgress=true)`);
          unstuckCount++;
        }
      }

      if (unstuckCount > 0) {
        log.info(`[SYNC] Auto-unstuck ${unstuckCount} wallets that had stale syncInProgress flags`);
      }

    } catch (error) {
      log.error('[SYNC] Failed to check for stale syncs', { error: getErrorMessage(error) });
    }
  }

  /**
   * Update confirmations for all wallets with pending transactions
   */
  private async updateAllConfirmations(): Promise<void> {
    if (!this.state.isRunning) return;

    try {
      const result = await refreshPendingConfirmations();
      for (const failure of result.failures) {
        log.error(`[SYNC] Failed to update confirmations for wallet ${failure.walletId}`, {
          error: getErrorMessage(failure.error),
        });
      }
      for (const failure of result.publicationFailures) {
        log.error(`[SYNC] Failed to publish confirmation update for wallet ${failure.walletId}`, {
          error: getErrorMessage(failure.error),
          txid: failure.txid,
        });
      }

      const totalUpdated = result.fieldUpdates + result.confirmationUpdateCount;
      if (totalUpdated > 0) {
        log.info(`[SYNC] Updated ${totalUpdated} transaction confirmations`);
      }
    } catch (error) {
      log.error('[SYNC] Failed to update confirmations', { error: getErrorMessage(error) });
    }
  }
}

// Export singleton instance
export const getSyncService = (): SyncService => SyncService.getInstance();

// Export for use in server startup
export default SyncService;
