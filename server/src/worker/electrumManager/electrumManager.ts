/**
 * Electrum Subscription Manager
 *
 * Thin orchestrator class that owns all state (Maps, callbacks, timers, lock)
 * and delegates to focused helper modules for each concern.
 */

import { closeAllElectrumClients } from '../../services/bitcoin/electrum';
import { getConfig } from '../../config';
import { createLogger } from '../../utils/logger';
import type { DistributedLock } from '../../infrastructure';
import { HEALTH_CHECK_INTERVAL_MS, ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS } from './types';
import type { BitcoinNetwork, NetworkState, ElectrumManagerCallbacks } from './types';
import { acquireSubscriptionLock, startLockRefresh, releaseSubscriptionLock } from './lockCoordination';
import { connectNetwork } from './networkConnection';
import { scheduleReconnect } from './reconnection';
import {
  subscribeAllAddresses,
  subscribeNetworkAddresses,
  subscribeWalletAddresses as doSubscribeWalletAddresses,
  unsubscribeWalletAddresses as doUnsubscribeWalletAddresses,
} from './addressSubscriptions';
import {
  checkHealth,
  reconcileSubscriptions as doReconcileSubscriptions,
  isConnected as checkIsConnected,
  getHealthMetrics as buildHealthMetrics,
} from './healthMonitoring';

const log = createLogger('WORKER:ELECTRUM_MGR');

export class ElectrumSubscriptionManager {
  private networks: Map<BitcoinNetwork, NetworkState> = new Map();
  private addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }> = new Map();
  private callbacks: ElectrumManagerCallbacks;
  private isRunningFlag = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private subscriptionLock: DistributedLock | null = null;
  private subscriptionLockRefresh: NodeJS.Timeout | null = null;
  private subscriptionLockRetryTimer: NodeJS.Timeout | null = null;
  private subscriptionLockRetryInFlight = false;
  private explicitlyStopped = false;

  constructor(callbacks: ElectrumManagerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Start the Electrum subscription manager
   */
  async start(): Promise<void> {
    this.explicitlyStopped = false;
    if (this.isRunningFlag) {
      log.warn('Electrum manager already running');
      return;
    }
    if (this.subscriptionLockRetryTimer) {
      log.debug('Electrum subscription ownership retry already scheduled');
      return;
    }

    const lock = await acquireSubscriptionLock();
    if (!lock) {
      this.startSubscriptionOwnershipRetry();
      return;
    }

    await this.startWithLock(lock);
  }

  private async startWithLock(lock: DistributedLock): Promise<void> {
    this.stopSubscriptionOwnershipRetry();
    this.subscriptionLock = lock;
    this.subscriptionLockRefresh = startLockRefresh(
      () => this.subscriptionLock,
      (l) => { this.subscriptionLock = l; },
      () => this.handleSubscriptionLockLost()
    );
    this.isRunningFlag = true;
    log.info('Starting Electrum subscription manager...');

    // Get configured network from config
    const config = getConfig();
    const primaryNetwork = config.bitcoin.network as BitcoinNetwork;

    try {
      // Connect to primary network
      await this.doConnectNetwork(primaryNetwork);

      // Subscribe to all wallet addresses
      await subscribeAllAddresses(this.networks, this.addressToWallet);

      // Start health check timer
      this.healthCheckTimer = setInterval(() => {
        this.doCheckHealth();
      }, HEALTH_CHECK_INTERVAL_MS);

      log.info('Electrum subscription manager started', {
        networks: Array.from(this.networks.keys()),
        subscribedAddresses: this.addressToWallet.size,
      });
    } catch (error) {
      await this.stopRunningManager();
      throw error;
    }
  }

  private startSubscriptionOwnershipRetry(): void {
    if (this.explicitlyStopped || this.subscriptionLockRetryTimer || this.isRunningFlag) {
      return;
    }

    log.info('Electrum subscription ownership unavailable; retrying until lock is acquired', {
      retryMs: ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS,
    });

    this.subscriptionLockRetryTimer = setInterval(() => {
      void this.tryAcquireSubscriptionOwnership();
    }, ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS);
    this.subscriptionLockRetryTimer.unref?.();
  }

  private stopSubscriptionOwnershipRetry(): void {
    if (!this.subscriptionLockRetryTimer) {
      return;
    }

    clearInterval(this.subscriptionLockRetryTimer);
    this.subscriptionLockRetryTimer = null;
  }

  private async tryAcquireSubscriptionOwnership(): Promise<void> {
    if (this.explicitlyStopped || this.subscriptionLockRetryInFlight || this.isRunningFlag) {
      return;
    }

    this.subscriptionLockRetryInFlight = true;
    try {
      const lock = await acquireSubscriptionLock();
      if (!lock) return;

      if (this.explicitlyStopped) {
        await releaseSubscriptionLock(lock, null);
        return;
      }

      try {
        await this.startWithLock(lock);
      } catch (error) {
        log.error('Failed to start Electrum subscription manager after acquiring retry lock', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.startSubscriptionOwnershipRetry();
      }
    } finally {
      this.subscriptionLockRetryInFlight = false;
    }
  }

  private async handleSubscriptionLockLost(): Promise<void> {
    await this.stopRunningManager();
    this.startSubscriptionOwnershipRetry();
  }

  private async doConnectNetwork(network: BitcoinNetwork): Promise<void> {
    await connectNetwork(
      network,
      this.networks,
      this.addressToWallet,
      this.callbacks,
      () => this.isRunningFlag,
      (net) => this.doScheduleReconnect(net)
    );
  }

  private doScheduleReconnect(network: BitcoinNetwork): void {
    scheduleReconnect(
      network,
      this.networks,
      this.addressToWallet,
      this.callbacks,
      () => this.isRunningFlag,
      (net) => subscribeNetworkAddresses(net, this.networks, this.addressToWallet)
    );
  }

  private async doCheckHealth(): Promise<void> {
    await checkHealth(this.networks, (net) => this.doScheduleReconnect(net));
  }

  /**
   * Subscribe to new addresses for a wallet (call when wallet is created or addresses generated)
   */
  async subscribeWalletAddresses(walletId: string): Promise<void> {
    await doSubscribeWalletAddresses(walletId, this.networks, this.addressToWallet);
  }

  /**
   * Unsubscribe addresses for a wallet (call when wallet is deleted)
   */
  unsubscribeWalletAddresses(walletId: string): void {
    doUnsubscribeWalletAddresses(walletId, this.networks, this.addressToWallet);
  }

  /**
   * Reconcile subscription state with database
   */
  async reconcileSubscriptions(): Promise<{ removed: number; added: number }> {
    return doReconcileSubscriptions(this.networks, this.addressToWallet);
  }

  /**
   * Check if the manager is connected to any network
   */
  isConnected(): boolean {
    return checkIsConnected(this.networks);
  }

  /**
   * Get health metrics for monitoring
   */
  getHealthMetrics() {
    return {
      ...buildHealthMetrics(this.isRunningFlag, this.networks, this.addressToWallet),
      ownershipRetryActive: this.subscriptionLockRetryTimer !== null,
    };
  }

  /**
   * Stop the Electrum subscription manager
   */
  async stop(): Promise<void> {
    this.explicitlyStopped = true;
    this.stopSubscriptionOwnershipRetry();
    await this.stopRunningManager();
  }

  private async stopRunningManager(): Promise<void> {
    if (!this.isRunningFlag) return;

    log.info('Stopping Electrum subscription manager...');
    this.isRunningFlag = false;

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    await releaseSubscriptionLock(this.subscriptionLock, this.subscriptionLockRefresh);
    this.subscriptionLock = null;
    this.subscriptionLockRefresh = null;

    // Clear reconnection timers
    for (const state of this.networks.values()) {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
    }

    // Close all Electrum connections
    closeAllElectrumClients();

    // Clear state
    this.networks.clear();
    this.addressToWallet.clear();

    log.info('Electrum subscription manager stopped');
  }
}
