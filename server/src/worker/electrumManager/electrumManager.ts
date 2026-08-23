/**
 * Electrum Subscription Manager
 *
 * Thin orchestrator class that owns all state (Maps, callbacks, timers, lock)
 * and delegates to focused helper modules for each concern.
 */

import { closeAllElectrumClients } from '../../services/bitcoin/electrum';
import { getConfig } from '../../config';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import {
  addressRepository,
} from '../../repositories';
import {
  LockAuthorityUnavailableError,
  type DistributedLock,
} from '../../infrastructure';
import { HEALTH_CHECK_INTERVAL_MS, ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS } from './types';
import type {
  AddressWalletInfo,
  BitcoinNetwork,
  NetworkState,
  ElectrumManagerCallbacks,
} from './types';
import { acquireSubscriptionLock, startLockRefresh, releaseSubscriptionLock } from './lockCoordination';
import { connectNetwork } from './networkConnection';
import { scheduleReconnect } from './reconnection';
import {
  subscribeAddressBatch,
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
  private addressToWallet: Map<string, AddressWalletInfo> = new Map();
  private callbacks: ElectrumManagerCallbacks;
  private isRunningFlag = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private subscriptionLock: DistributedLock | null = null;
  private subscriptionLockRefresh: NodeJS.Timeout | null = null;
  private subscriptionLockRetryTimer: NodeJS.Timeout | null = null;
  private subscriptionLockRetryInFlight = false;
  private startupInFlight = false;
  private ownershipEpoch = 0;
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

    let lock: DistributedLock | null;
    try {
      lock = await acquireSubscriptionLock();
    } catch (error) {
      if (!(error instanceof LockAuthorityUnavailableError)) {
        throw error;
      }
      log.error('Electrum subscription lock authority unavailable; retrying', {
        error: error.message,
      });
      this.startSubscriptionOwnershipRetry();
      return;
    }
    if (this.explicitlyStopped) {
      await releaseSubscriptionLock(lock, null);
      return;
    }
    if (!lock) {
      this.startSubscriptionOwnershipRetry();
      return;
    }

    await this.startWithLock(lock);
  }

  private async startWithLock(lock: DistributedLock): Promise<void> {
    const ownershipEpoch = ++this.ownershipEpoch;
    this.startupInFlight = true;
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
      await this.doConnectNetwork(primaryNetwork, ownershipEpoch);
      if (!this.hasOwnership(ownershipEpoch)) {
        await this.stopRunningManager();
        return;
      }
      if (this.networks.get(primaryNetwork)?.connected) {
        await this.callbacks.onNetworkReady?.(primaryNetwork);
        if (!this.hasOwnership(ownershipEpoch)) {
          await this.stopRunningManager();
          return;
        }
      }

      // Subscribe to all wallet addresses
      await subscribeAllAddresses(
        this.networks,
        this.addressToWallet,
        undefined,
        () => this.hasOwnership(ownershipEpoch),
      );
      if (!this.hasOwnership(ownershipEpoch)) {
        await this.stopRunningManager();
        return;
      }
      // Start health check timer
      this.healthCheckTimer = setInterval(() => {
        this.doCheckHealth();
      }, HEALTH_CHECK_INTERVAL_MS);

      log.info('Electrum subscription manager started', {
        networks: Array.from(this.networks.keys()),
        subscribedAddresses: this.addressToWallet.size,
      });
    } catch (error) {
      if (!this.hasOwnership(ownershipEpoch)) return;
      await this.stopRunningManager();
      throw error;
    } finally {
      this.startupInFlight = false;
    }
  }

  private hasOwnership(epoch: number): boolean {
    return this.isRunningFlag
      && this.subscriptionLock !== null
      && this.ownershipEpoch === epoch;
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
    if (this.explicitlyStopped
      || this.subscriptionLockRetryInFlight
      || this.startupInFlight
      || this.isRunningFlag) {
      return;
    }

    this.subscriptionLockRetryInFlight = true;
    try {
      const lock = await acquireSubscriptionLock();
      /* v8 ignore next -- no-lock retry branch is covered through start retry scheduling tests */
      if (!lock) return;

      if (this.explicitlyStopped) {
        await releaseSubscriptionLock(lock, null);
        return;
      }

      try {
        await this.startWithLock(lock);
      } catch (error) {
        log.error('Failed to start Electrum subscription manager after acquiring retry lock', {
          /* v8 ignore start -- caught retry startup failures are Error instances in current callers */
          error: error instanceof Error ? error.message : String(error),
          /* v8 ignore stop */
        });
        this.startSubscriptionOwnershipRetry();
      }
    } catch (error) {
      log.error('Electrum subscription lock acquisition failed; retrying', {
        error: getErrorMessage(error),
      });
    } finally {
      this.subscriptionLockRetryInFlight = false;
    }
  }

  private async handleSubscriptionLockLost(): Promise<void> {
    await this.stopRunningManager();
    this.startSubscriptionOwnershipRetry();
  }

  private async doConnectNetwork(network: BitcoinNetwork, ownershipEpoch = this.ownershipEpoch): Promise<void> {
    await connectNetwork(
      network,
      this.networks,
      this.addressToWallet,
      this.callbacks,
      () => this.hasOwnership(ownershipEpoch),
      (net) => this.doScheduleReconnect(net, ownershipEpoch)
    );
  }

  private doScheduleReconnect(
    network: BitcoinNetwork,
    ownershipEpoch = this.ownershipEpoch,
  ): void {
    const hasOwnership = () => this.hasOwnership(ownershipEpoch);
    scheduleReconnect(
      network,
      this.networks,
      this.addressToWallet,
      this.callbacks,
      hasOwnership,
      async (net) => {
        await this.callbacks.onNetworkReady?.(net);
        if (!hasOwnership()) return;
        await subscribeNetworkAddresses(
          net,
          this.networks,
          this.addressToWallet,
          undefined,
          { isActive: hasOwnership },
        );
      },
    );
  }

  private async doCheckHealth(): Promise<void> {
    const ownershipEpoch = this.ownershipEpoch;
    /* v8 ignore start -- health-check reconnect callback is covered through standalone manager tests */
    await checkHealth(
      this.networks,
      (net) => this.doScheduleReconnect(net, ownershipEpoch),
      () => this.hasOwnership(ownershipEpoch),
    );
    /* v8 ignore stop */
  }

  /**
   * Subscribe to new addresses for a wallet (call when wallet is created or addresses generated)
   */
  async subscribeWalletAddresses(walletId: string): Promise<void> {
    const ownershipEpoch = this.ownershipEpoch;
    await doSubscribeWalletAddresses(
      walletId,
      this.networks,
      this.addressToWallet,
      () => this.hasOwnership(ownershipEpoch),
    );
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
    const ownershipEpoch = this.ownershipEpoch;
    return doReconcileSubscriptions(
      this.networks,
      this.addressToWallet,
      undefined,
      () => this.hasOwnership(ownershipEpoch),
    );
  }

  /** Re-read one fair authoritative status page so transient checkpoint writes self-heal. */
  async refreshSubscriptionStatusPage(
    network: BitcoinNetwork,
    options: { cursor?: string; limit: number },
  ): Promise<{ scanned: number; nextCursor?: string }> {
    const ownershipEpoch = this.ownershipEpoch;
    if (!this.hasOwnership(ownershipEpoch)) return { scanned: 0 };
    const addresses = await addressRepository.findAllWithWalletNetworkPaginated({
      take: options.limit,
      ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    });
    if (!this.hasOwnership(ownershipEpoch)) return { scanned: 0 };
    const state = this.networks.get(network);
    if (state?.connected) {
      const networkAddresses = addresses
        .filter((address) => address.wallet.network === network)
        .map((address) => ({ address: address.address, walletId: address.walletId }));
      await subscribeAddressBatch(state, networkAddresses, {
        resubscribe: true,
        isActive: () => this.hasOwnership(ownershipEpoch),
      });
    }
    return {
      scanned: addresses.length,
      ...(addresses.length === options.limit
        ? { nextCursor: addresses[addresses.length - 1].id }
        : {}),
    };
  }

  /** Subscribe through the elected worker-owned transport and return exact statuses. */
  async subscribeCheckpointAddresses(
    network: BitcoinNetwork,
    addresses: string[],
  ): Promise<Map<string, string | null>> {
    const ownershipEpoch = this.ownershipEpoch;
    if (!this.hasOwnership(ownershipEpoch)) {
      throw new Error('Electrum subscription ownership is not active');
    }
    const state = this.networks.get(network);
    if (!state?.connected) {
      throw new Error(`Electrum network ${network} is not connected`);
    }
    return subscribeAddressBatch(
      state,
      addresses.map((address) => ({ address, walletId: '' })),
      {
        resubscribe: true,
        isActive: () => this.hasOwnership(ownershipEpoch),
      },
    );
  }

  isSubscriptionOwner(): boolean {
    return this.isRunningFlag && this.subscriptionLock !== null;
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
    const hadRuntime = this.isRunningFlag
      || this.subscriptionLock !== null
      || this.subscriptionLockRefresh !== null
      || this.healthCheckTimer !== null
      || this.networks.size > 0
      || this.addressToWallet.size > 0;
    this.isRunningFlag = false;
    this.ownershipEpoch += 1;
    if (hadRuntime) log.info('Stopping Electrum subscription manager...');

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    const lock = this.subscriptionLock;
    const lockRefresh = this.subscriptionLockRefresh;
    this.subscriptionLock = null;
    this.subscriptionLockRefresh = null;
    await releaseSubscriptionLock(lock, lockRefresh);

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

    if (hadRuntime) log.info('Electrum subscription manager stopped');
  }
}
