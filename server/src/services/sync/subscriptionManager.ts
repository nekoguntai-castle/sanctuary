/**
 * Electrum Subscription Manager
 *
 * Manages real-time Electrum subscriptions for:
 * - Block header notifications (new blocks)
 * - Address activity notifications (incoming/outgoing transactions)
 * - Distributed lock management for subscription ownership
 * - Address-to-wallet mapping with periodic reconciliation
 */

import { db as prisma } from '../../repositories/db';
import { setCachedBlockHeight } from '../bitcoin/blockchain';
import { getNodeClient, getElectrumClientIfActive } from '../bitcoin/nodeClient';
import { getNotificationService } from '../../websocket/notifications';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getConfig } from '../../config';
import { eventService } from '../eventService';
import { acquireLock, extendLock, releaseLock } from '../../infrastructure';
import type { SyncState } from './types';
import {
  ELECTRUM_SUBSCRIPTION_LOCK_KEY,
  ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS,
  ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS,
} from './types';

const log = createLogger('SYNC:SVC_SUBS');

/**
 * Set up real-time subscriptions for block and address notifications.
 *
 * @param queueSync - Callback to queue a wallet sync (avoids circular dependency with queue module).
 * @param updateAllConfirmations - Callback to update confirmations for all pending transactions.
 */
export async function setupRealTimeSubscriptions(
  state: SyncState,
  queueSync: (walletId: string, priority: 'high' | 'normal' | 'low') => void,
  updateAllConfirmations: () => Promise<void>,
): Promise<void> {
  try {
    const syncConfig = getConfig().sync;
    state.subscriptionsEnabled = syncConfig.electrumSubscriptionsEnabled;

    if (!state.subscriptionsEnabled) {
      state.subscriptionOwnership = 'disabled';
      log.info('[SYNC] Server-side Electrum subscriptions disabled by config');
      return;
    }

    const lock = await acquireLock(ELECTRUM_SUBSCRIPTION_LOCK_KEY, ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
    if (!lock) {
      state.subscriptionOwnership = 'external';
      log.info('[SYNC] Electrum subscriptions owned by another process, skipping setup');
      return;
    }

    state.subscriptionLock = lock;
    state.subscriptionOwnership = 'self';
    startSubscriptionLockRefresh(state, updateAllConfirmations);
    log.info('[SYNC] Acquired Electrum subscription ownership');

    // Get the node client to ensure it's connected
    await getNodeClient();

    // Only Electrum supports real-time subscriptions
    const electrumClient = await getElectrumClientIfActive();
    if (!electrumClient) {
      log.info('[SYNC] Real-time subscriptions only available with Electrum (current node type does not support it)');
      await releaseSubscriptionLock(state);
      state.subscriptionOwnership = 'disabled';
      return;
    }

    // Negotiate protocol version first (required by some servers like Blockstream)
    try {
      const version = await electrumClient.getServerVersion();
      log.info(`[SYNC] Connected to Electrum server: ${version.server} (protocol ${version.protocol})`);
    } catch (versionError) {
      log.warn('[SYNC] Could not get server version, continuing anyway', { error: getErrorMessage(versionError) });
    }

    // Subscribe to new block headers
    if (!state.subscribedToHeaders) {
      const currentHeader = await electrumClient.subscribeHeaders();
      state.subscribedToHeaders = true;
      log.info(`[SYNC] Subscribed to block headers, current height: ${currentHeader.height}`);

      // Cache the current block height for the configured network
      setCachedBlockHeight(currentHeader.height, getConfig().bitcoin.network);

      // Listen for new blocks
      electrumClient.on('newBlock', (block: { height: number; hex: string }) => {
        handleNewBlock(state, block, updateAllConfirmations);
      });

      // Listen for address activity
      electrumClient.on('addressActivity', (activity: { scriptHash: string; address?: string; status: string }) => {
        handleAddressActivity(state, activity, queueSync);
      });
    }

    // Subscribe to all wallet addresses
    await subscribeAllWalletAddresses(state);

    log.info('[SYNC] Real-time subscriptions active');
  } catch (error) {
    log.error('[SYNC] Failed to set up real-time subscriptions', { error: getErrorMessage(error) });
    await releaseSubscriptionLock(state);
    if (state.subscriptionsEnabled) {
      state.subscriptionOwnership = 'external';
    }
  }
}

/**
 * Start periodic refresh of the subscription distributed lock.
 */
export function startSubscriptionLockRefresh(
  state: SyncState,
  _updateAllConfirmations: () => Promise<void>,
  teardown?: () => Promise<void>,
): void {
  if (state.subscriptionLockRefresh) return;

  state.subscriptionLockRefresh = setInterval(async () => {
    if (!state.subscriptionLock) return;

    const refreshed = await extendLock(state.subscriptionLock, ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
    if (!refreshed) {
      log.warn('[SYNC] Lost Electrum subscription lock, disabling subscriptions');
      state.subscriptionLock = null;
      state.subscriptionOwnership = 'external';
      stopSubscriptionLockRefresh(state);
      // Use delegate if provided (for testability), otherwise call directly
      if (teardown) {
        await teardown();
      } else {
        await teardownRealTimeSubscriptions(state);
      }
      return;
    }

    state.subscriptionLock = refreshed;
  }, ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS);

  state.subscriptionLockRefresh.unref?.();
}

/**
 * Stop the subscription lock refresh interval.
 */
export function stopSubscriptionLockRefresh(state: SyncState): void {
  if (state.subscriptionLockRefresh) {
    clearInterval(state.subscriptionLockRefresh);
    state.subscriptionLockRefresh = null;
  }
}

/**
 * Release the subscription distributed lock.
 */
export async function releaseSubscriptionLock(state: SyncState): Promise<void> {
  stopSubscriptionLockRefresh(state);
  if (state.subscriptionLock) {
    await releaseLock(state.subscriptionLock);
    state.subscriptionLock = null;
  }
}

/**
 * Subscribe to all addresses from all wallets for real-time notifications.
 * Uses batch subscription for efficiency (single RPC call vs N calls).
 */
export async function subscribeAllWalletAddresses(state: SyncState): Promise<void> {
  if (state.subscriptionOwnership !== 'self') {
    return;
  }

  const electrumClient = await getElectrumClientIfActive();
  if (!electrumClient) return;

  const addressRecords = await prisma.address.findMany({
    select: { address: true, walletId: true },
  });

  if (addressRecords.length === 0) {
    log.info('[SYNC] No addresses to subscribe to');
    return;
  }

  // Build address to wallet mapping
  const addressToWallet = new Map<string, string>();
  const addresses: string[] = [];
  for (const { address, walletId } of addressRecords) {
    addresses.push(address);
    addressToWallet.set(address, walletId);
  }

  try {
    // Batch subscribe to all addresses in a single RPC call
    const results = await electrumClient.subscribeAddressBatch(addresses);

    // Update our address to wallet mapping for successfully subscribed addresses
    let subscribed = 0;
    for (const [address] of results) {
      const walletId = addressToWallet.get(address);
      if (walletId) {
        state.addressToWalletMap.set(address, walletId);
        subscribed++;
      }
    }

    log.info(`[SYNC] Batch subscribed to ${subscribed} addresses for real-time notifications`);
  } catch (error) {
    log.error('[SYNC] Batch subscription failed, falling back to individual subscriptions', { error: getErrorMessage(error) });

    // Fallback to individual subscriptions if batch fails
    let subscribed = 0;
    for (const address of addresses) {
      try {
        await electrumClient.subscribeAddress(address);
        const walletId = addressToWallet.get(address);
        if (walletId) {
          state.addressToWalletMap.set(address, walletId);
          subscribed++;
        }
      } catch (err) {
        log.error(`[SYNC] Failed to subscribe to address ${address}`, { error: getErrorMessage(err) });
      }
    }
    log.info(`[SYNC] Fallback: subscribed to ${subscribed} addresses individually`);
  }
}

/**
 * Unsubscribe all addresses for a wallet (call when wallet is deleted).
 * Prevents memory leak by cleaning up the addressToWalletMap.
 */
export async function unsubscribeWalletAddresses(state: SyncState, walletId: string): Promise<void> {
  if (state.subscriptionOwnership !== 'self') {
    return;
  }

  const electrumClient = await getElectrumClientIfActive();

  let unsubscribed = 0;
  for (const [address, wId] of state.addressToWalletMap.entries()) {
    if (wId === walletId) {
      state.addressToWalletMap.delete(address);
      if (electrumClient) {
        try {
          await electrumClient.unsubscribeAddress(address);
          unsubscribed++;
        } catch (error) {
          log.debug(`[SYNC] Failed to unsubscribe address ${address} (non-critical)`, { error: getErrorMessage(error) });
        }
      }
    }
  }

  if (unsubscribed > 0) {
    log.debug(`[SYNC] Unsubscribed ${unsubscribed} addresses for wallet ${walletId}`);
  }
}

/**
 * Reconcile addressToWalletMap against the database.
 * Removes entries for wallets that no longer exist, preventing memory leaks
 * from wallets that were deleted without proper cleanup.
 */
export async function reconcileAddressToWalletMap(state: SyncState): Promise<void> {
  if (state.addressToWalletMap.size === 0 && state.subscriptionOwnership !== 'self') {
    return;
  }

  const addressRecords = await prisma.address.findMany({
    select: { address: true, walletId: true },
  });

  if (addressRecords.length === 0) {
    if (state.addressToWalletMap.size > 0) {
      state.addressToWalletMap.clear();
    }
    return;
  }

  const dbAddressMap = new Map(addressRecords.map(({ address, walletId }) => [address, walletId]));

  // Remove entries for wallets that no longer exist
  let removed = 0;
  for (const [address, walletId] of state.addressToWalletMap.entries()) {
    if (dbAddressMap.get(address) !== walletId) {
      state.addressToWalletMap.delete(address);
      removed++;
    }
  }

  let added = 0;
  if (state.subscriptionOwnership === 'self') {
    const electrumClient = await getElectrumClientIfActive();

    if (electrumClient) {
      const newAddressRecords = addressRecords.filter(({ address }) => !state.addressToWalletMap.has(address));

      if (newAddressRecords.length > 0) {
        try {
          const results = await electrumClient.subscribeAddressBatch(newAddressRecords.map(({ address }) => address));
          for (const [address] of results) {
            const walletId = dbAddressMap.get(address);
            if (!walletId) continue;
            state.addressToWalletMap.set(address, walletId);
            added++;
          }
        } catch (error) {
          log.error('[SYNC] Batch subscription failed during reconciliation, falling back to individual subscriptions', {
            error: getErrorMessage(error),
          });

          for (const { address, walletId } of newAddressRecords) {
            try {
              await electrumClient.subscribeAddress(address);
              state.addressToWalletMap.set(address, walletId);
              added++;
            } catch (subscribeError) {
              log.error(`[SYNC] Failed to subscribe reconciled address ${address}`, {
                error: getErrorMessage(subscribeError),
              });
            }
          }
        }
      }
    }
  }

  if (removed > 0 || added > 0) {
    log.info(`[SYNC] Reconciliation updated address mappings (map size: ${state.addressToWalletMap.size})`, {
      removed,
      added,
    });
  } else {
    log.debug(`[SYNC] Reconciliation complete, no address mapping changes (map size: ${state.addressToWalletMap.size})`);
  }
}

/**
 * Subscribe to new addresses for a wallet (called when wallet is created/imported).
 */
export async function subscribeNewWalletAddresses(state: SyncState, walletId: string): Promise<void> {
  if (state.subscriptionOwnership !== 'self') {
    return;
  }

  const electrumClient = await getElectrumClientIfActive();
  if (!electrumClient) return;

  const addresses = await prisma.address.findMany({
    where: { walletId },
    select: { address: true },
  });

  for (const { address } of addresses) {
    try {
      if (!state.addressToWalletMap.has(address)) {
        await electrumClient.subscribeAddress(address);
        state.addressToWalletMap.set(address, walletId);
      }
    } catch (error) {
      log.error(`[SYNC] Failed to subscribe to new address ${address}`, { error: getErrorMessage(error) });
    }
  }

  log.info(`[SYNC] Subscribed to ${addresses.length} addresses for new wallet ${walletId}`);
}

/**
 * Tear down all real-time subscriptions.
 */
export async function teardownRealTimeSubscriptions(state: SyncState): Promise<void> {
  state.subscribedToHeaders = false;

  const electrumClient = await getElectrumClientIfActive();
  if (electrumClient && state.addressToWalletMap.size > 0) {
    for (const address of state.addressToWalletMap.keys()) {
      try {
        await electrumClient.unsubscribeAddress(address);
      } catch (error) {
        log.debug(`[SYNC] Failed to unsubscribe address ${address} (non-critical)`, { error: getErrorMessage(error) });
      }
    }
  }

  state.addressToWalletMap.clear();

  if (electrumClient) {
    electrumClient.removeAllListeners('newBlock');
    electrumClient.removeAllListeners('addressActivity');
  }
}

/**
 * Subscribe to Electrum address notifications for a wallet.
 * This enables real-time updates when transactions are received.
 */
export async function subscribeWalletAddresses(walletId: string): Promise<void> {
  // Get wallet to determine network
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { network: true }
  });
  const network = (wallet?.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';

  const addresses = await prisma.address.findMany({
    where: { walletId },
    select: { address: true },
  });

  const client = await getNodeClient(network);

  for (const { address } of addresses) {
    try {
      // Subscribe to address - Electrum/RPC will notify on changes (if supported)
      await client.subscribeAddress(address);
    } catch (error) {
      log.error(`[SYNC] Failed to subscribe to address ${address}`, { error: getErrorMessage(error) });
    }
  }

  log.info(`[SYNC] Subscribed to ${addresses.length} addresses for wallet ${walletId}`);
}

/**
 * Handle new block notification - immediately update confirmations.
 */
export async function handleNewBlock(
  _state: SyncState,
  block: { height: number; hex: string },
  updateAllConfirmations: () => Promise<void>,
): Promise<void> {
  log.info(`[SYNC] New block received at height ${block.height}`);

  // Update cached block height for the configured network
  const network = getConfig().bitcoin.network;
  setCachedBlockHeight(block.height, network);

  // Emit new block event (handles both event bus and WebSocket)
  eventService.emitNewBlock(network, block.height, block.hex.slice(0, 64));

  // Immediately update confirmations for all pending transactions
  try {
    await updateAllConfirmations();

    // Notify frontend of new block
    const notificationService = getNotificationService();
    notificationService.broadcastNewBlock({
      height: block.height,
    });
  } catch (error) {
    log.error('[SYNC] Failed to update confirmations after new block', { error: getErrorMessage(error) });
  }
}

/**
 * Handle address activity notification - queue affected wallet for sync.
 */
export async function handleAddressActivity(
  state: SyncState,
  activity: { scriptHash: string; address?: string; status: string },
  queueSync: (walletId: string, priority: 'high' | 'normal' | 'low') => void,
): Promise<void> {
  const address = activity.address;
  if (!address) {
    log.warn('[SYNC] Received address activity without resolved address');
    return;
  }

  log.info(`[SYNC] Address activity detected: ${address}`);

  // Find the wallet for this address
  const walletId = state.addressToWalletMap.get(address);
  if (walletId) {
    // Queue high-priority sync for this wallet
    queueSync(walletId, 'high');
    log.info(`[SYNC] Queued high-priority sync for wallet ${walletId} due to address activity`);
  } else {
    // Try to look up the wallet from the database
    const addressRecord = await prisma.address.findFirst({
      where: { address },
      select: { walletId: true },
    });

    if (addressRecord) {
      state.addressToWalletMap.set(address, addressRecord.walletId);
      queueSync(addressRecord.walletId, 'high');
      log.info(`[SYNC] Queued high-priority sync for wallet ${addressRecord.walletId} due to address activity`);
    }
  }
}
