/**
 * Health Monitoring
 *
 * Connection health checks, subscription reconciliation, and metrics
 * reporting for the Electrum subscription manager.
 */

import { addressRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { subscribeAddressBatch } from './addressSubscriptions';
import type { BitcoinNetwork, NetworkState } from './types';

const log = createLogger('WORKER:ELECTRUM_HEALTH');
const RECONCILE_PAGE_SIZE = 2000;

type AddressWalletInfo = { walletId: string; network: BitcoinNetwork };
type ReconcileAddress = Awaited<ReturnType<typeof addressRepository.findAllWithWalletNetworkPaginated>>[number];
type NewAddressesByNetwork = Map<BitcoinNetwork, Array<{ address: string; walletId: string }>>;

/**
 * Check health of all connections and reconnect if needed.
 */
export async function checkHealth(
  networks: Map<BitcoinNetwork, NetworkState>,
  scheduleReconnect: (network: BitcoinNetwork) => void
): Promise<void> {
  for (const [network, state] of networks) {
    if (!state.connected) {
      log.debug(`Health check: ${network} disconnected`);
      continue;
    }

    // Verify connection is actually working
    try {
      // Simple ping by getting server version
      await state.client.getServerVersion();
      log.debug(`Health check: ${network} OK`);
    } catch (error) {
      log.warn(`Health check: ${network} failed`, { error: getErrorMessage(error) });
      state.connected = false;
      scheduleReconnect(network);
    }
  }
}

/**
 * Reconcile subscription state with database.
 *
 * Removes addresses that no longer exist in the database and
 * subscribes to any new addresses. This prevents unbounded memory
 * growth from deleted wallets/addresses.
 *
 * Uses cursor-based pagination to handle large deployments without
 * loading all addresses into memory at once.
 */
export async function reconcileSubscriptions(
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>
): Promise<{ removed: number; added: number }> {
  log.info('Reconciling Electrum subscriptions with database...');

  const dbAddressSet = new Set<string>();
  let added = 0;
  let cursor: string | undefined;

  // First pass: Paginate through database addresses
  // - Build a set of all addresses (just strings, lightweight)
  // - Find and subscribe to new addresses in batches
  while (true) {
    const addresses = await addressRepository.findAllWithWalletNetworkPaginated({
      take: RECONCILE_PAGE_SIZE,
      cursor,
    });

    if (addresses.length === 0) break;

    const pageResult = collectReconcilePage(addresses, dbAddressSet, addressToWallet);
    added += pageResult.added;
    await subscribeNewAddressesByNetwork(networks, pageResult.newAddressesByNetwork);

    cursor = addresses[addresses.length - 1].id;
    if (addresses.length < RECONCILE_PAGE_SIZE) break;
  }

  // Second pass: Remove addresses that no longer exist in database
  const removed = removeDeletedAddresses(dbAddressSet, networks, addressToWallet);
  logReconcileSummary(removed, added, addressToWallet.size);

  return { removed, added };
}

function collectReconcilePage(
  addresses: ReconcileAddress[],
  dbAddressSet: Set<string>,
  addressToWallet: Map<string, AddressWalletInfo>
): { newAddressesByNetwork: NewAddressesByNetwork; added: number } {
  const newAddressesByNetwork = new Map<BitcoinNetwork, Array<{ address: string; walletId: string }>>();
  let added = 0;

  for (const addr of addresses) {
    dbAddressSet.add(addr.address);

    if (!addressToWallet.has(addr.address)) {
      trackNewAddress(addr, addressToWallet, newAddressesByNetwork);
      added++;
    }
  }

  return { newAddressesByNetwork, added };
}

function trackNewAddress(
  addr: ReconcileAddress,
  addressToWallet: Map<string, AddressWalletInfo>,
  newAddressesByNetwork: NewAddressesByNetwork
): void {
  const network = (addr.wallet.network || 'mainnet') as BitcoinNetwork;
  getNetworkAddressBatch(newAddressesByNetwork, network).push({
    address: addr.address,
    walletId: addr.walletId,
  });

  addressToWallet.set(addr.address, {
    walletId: addr.walletId,
    network,
  });
}

function getNetworkAddressBatch(
  newAddressesByNetwork: NewAddressesByNetwork,
  network: BitcoinNetwork
): Array<{ address: string; walletId: string }> {
  const networkAddresses = newAddressesByNetwork.get(network);
  if (networkAddresses) {
    return networkAddresses;
  }

  const newNetworkAddresses: Array<{ address: string; walletId: string }> = [];
  newAddressesByNetwork.set(network, newNetworkAddresses);
  return newNetworkAddresses;
}

async function subscribeNewAddressesByNetwork(
  networks: Map<BitcoinNetwork, NetworkState>,
  newAddressesByNetwork: NewAddressesByNetwork
): Promise<void> {
  for (const [network, networkAddresses] of newAddressesByNetwork) {
    const state = networks.get(network);
    if (!state?.connected || networkAddresses.length === 0) {
      continue;
    }

    await subscribeAddressBatch(state, networkAddresses);
  }
}

function removeDeletedAddresses(
  dbAddressSet: Set<string>,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, AddressWalletInfo>
): number {
  let removed = 0;

  for (const [address, info] of addressToWallet) {
    if (dbAddressSet.has(address)) {
      continue;
    }

    addressToWallet.delete(address);
    networks.get(info.network)?.subscribedAddresses.delete(address);
    removed++;
  }

  return removed;
}

function logReconcileSummary(removed: number, added: number, totalSubscribed: number): void {
  if (removed > 0 || added > 0) {
    log.info('Subscription reconciliation complete', {
      removed,
      added,
      totalSubscribed,
    });
  } else {
    log.debug('Subscription reconciliation complete - no changes');
  }
}

/**
 * Check if any network is connected.
 */
export function isConnected(networks: Map<BitcoinNetwork, NetworkState>): boolean {
  for (const state of networks.values()) {
    if (state.connected) return true;
  }
  return false;
}

/**
 * Get health metrics for monitoring.
 */
export function getHealthMetrics(
  isRunning: boolean,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>
): {
  isRunning: boolean;
  networks: Record<string, {
    connected: boolean;
    subscribedToHeaders: boolean;
    subscribedAddresses: number;
    lastBlockHeight: number;
    reconnectAttempts: number;
  }>;
  totalSubscribedAddresses: number;
} {
  const networkMetrics: Record<string, {
    connected: boolean;
    subscribedToHeaders: boolean;
    subscribedAddresses: number;
    lastBlockHeight: number;
    reconnectAttempts: number;
  }> = {};

  for (const [network, state] of networks) {
    networkMetrics[network] = {
      connected: state.connected,
      subscribedToHeaders: state.subscribedToHeaders,
      subscribedAddresses: state.subscribedAddresses.size,
      lastBlockHeight: state.lastBlockHeight,
      reconnectAttempts: state.reconnectAttempts,
    };
  }

  return {
    isRunning,
    networks: networkMetrics,
    totalSubscribedAddresses: addressToWallet.size,
  };
}
