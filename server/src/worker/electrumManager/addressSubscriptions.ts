/**
 * Address Subscriptions
 *
 * Manages subscribing and unsubscribing wallet addresses to/from
 * Electrum servers with cursor-based pagination for large deployments.
 */

import { walletRepository, addressRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { resolvePersistedBitcoinNetwork } from '../../services/bitcoin/networks';
import { SUBSCRIPTION_BATCH_SIZE } from './types';
import {
  getAddressFromSubscriptionKey,
  getAddressSubscriptionKey,
  type AddressWalletInfo,
  type BitcoinNetwork,
  type NetworkState,
} from './types';
import {
  attachSubscriptionBaseline,
  beginSubscriptionBaseline,
  releaseSubscriptionBaseline,
  releaseSubscriptionOperationWithBaseline,
} from './subscriptionBaselines';

const log = createLogger('WORKER:ELECTRUM_ADDR');

interface SubscriptionExecutionOptions {
  resubscribe?: boolean;
  isActive?: () => boolean;
  observeStatuses?: (
    network: BitcoinNetwork,
    statuses: Map<string, string | null>,
  ) => Promise<void>;
  deferBaselineRelease?: boolean;
}

class SubscriptionOwnershipChangedError extends Error {
  constructor() {
    super('Electrum subscription ownership changed during network work');
    this.name = 'SubscriptionOwnershipChangedError';
  }
}

function requireActiveOwnership(
  state: NetworkState | undefined,
  isActive: (() => boolean) | undefined,
): void {
  if (!isActive || isActive()) return;
  if (state) {
    state.connected = false;
    state.client.disconnect();
  }
  throw new SubscriptionOwnershipChangedError();
}

/**
 * Subscribe to all wallet addresses across all networks.
 *
 * Uses cursor-based pagination to handle large numbers of addresses
 * without loading everything into memory at once.
 */
export async function subscribeAllAddresses(
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, AddressWalletInfo>,
  observeStatuses?: (
    network: BitcoinNetwork,
    statuses: Map<string, string | null>,
  ) => Promise<void>,
  isActive?: () => boolean,
): Promise<void> {
  log.info('Subscribing to all wallet addresses...');

  const PAGE_SIZE = 1000;
  let totalProcessed = 0;
  let cursor: string | undefined;

  // Process addresses in pages to avoid memory issues with large deployments
  while (true) {
    requireActiveOwnership(undefined, isActive);
    const addresses = await addressRepository.findAllWithWalletNetworkPaginated({
      take: PAGE_SIZE,
      cursor,
    });
    requireActiveOwnership(undefined, isActive);

    if (addresses.length === 0) break;

    // Group by network for this batch
    const byNetwork = new Map<BitcoinNetwork, Array<{ address: string; walletId: string }>>();

    for (const addr of addresses) {
      const network = resolvePersistedBitcoinNetwork(addr.wallet.network);

      if (!byNetwork.has(network)) {
        byNetwork.set(network, []);
      }
      byNetwork.get(network)!.push({
        address: addr.address,
        walletId: addr.walletId,
      });

      // Track address -> wallet mapping
      addressToWallet.set(getAddressSubscriptionKey(network, addr.address), {
        walletId: addr.walletId,
        network,
      });
    }

    // Subscribe for each network in this batch
    for (const [network, networkAddresses] of byNetwork) {
      const state = networks.get(network);
      if (!state?.connected) {
        log.warn(`Cannot subscribe addresses for ${network} - not connected`);
        continue;
      }

      await subscribeAddressBatch(state, networkAddresses, { isActive, observeStatuses });
      requireActiveOwnership(state, isActive);
    }

    totalProcessed += addresses.length;
    cursor = addresses[addresses.length - 1].id;

    // Log progress for large deployments
    if (totalProcessed % 5000 === 0) {
      log.info(`Subscription progress: ${totalProcessed} addresses processed`);
    }

    // If we got less than PAGE_SIZE, we're done
    if (addresses.length < PAGE_SIZE) break;
  }

  log.info(`Subscribed to ${addressToWallet.size} addresses`);
}

/**
 * Subscribe to addresses for a specific network from the tracking map.
 */
export async function subscribeNetworkAddresses(
  network: BitcoinNetwork,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, AddressWalletInfo>,
  observeStatuses?: (
    network: BitcoinNetwork,
    statuses: Map<string, string | null>,
  ) => Promise<void>,
  options: SubscriptionExecutionOptions = {},
): Promise<void> {
  requireActiveOwnership(undefined, options.isActive);
  const state = networks.get(network);
  if (!state?.connected) return;

  // Get addresses for this network from our tracking
  const networkAddresses: Array<{ address: string; walletId: string }> = [];

  for (const [key, info] of addressToWallet) {
    if (info.network === network) {
      networkAddresses.push({
        address: getAddressFromSubscriptionKey(key),
        walletId: info.walletId,
      });
    }
  }

  if (networkAddresses.length > 0) {
    await subscribeAddressBatch(state, networkAddresses, { ...options, observeStatuses });
    requireActiveOwnership(state, options.isActive);
  }
}

/**
 * Subscribe to a batch of addresses on a specific network.
 */
const subscriptionOperationTails = new WeakMap<NetworkState, Promise<void>>();

async function executeSubscriptionAddressBatch(
  state: NetworkState,
  addresses: Array<{ address: string; walletId: string }>,
  options: SubscriptionExecutionOptions = {},
): Promise<Map<string, string | null>> {
  const { client, network } = state;
  const statuses = new Map<string, string | null>();
  requireActiveOwnership(state, options.isActive);

  // Filter out already subscribed addresses
  const candidates = options.resubscribe
    ? addresses
    : addresses.filter(a => !state.subscribedAddresses.has(a.address));
  const toSubscribe = [...new Map(
    candidates.map((candidate) => [candidate.address, candidate]),
  ).values()];

  if (toSubscribe.length === 0) {
    log.debug(`No new addresses to subscribe for ${network}`);
    return statuses;
  }

  log.info(`Subscribing to ${toSubscribe.length} addresses on ${network}`);
  const baseline = beginSubscriptionBaseline(state, toSubscribe.map(({ address }) => address));
  let baselineDeferred = false;

  try {
    // Subscribe in batches
    for (let i = 0; i < toSubscribe.length; i += SUBSCRIPTION_BATCH_SIZE) {
      const batch = toSubscribe.slice(i, i + SUBSCRIPTION_BATCH_SIZE);
      const addressList = batch.map(a => a.address);

      try {
        requireActiveOwnership(state, options.isActive);
        const batchStatuses = await client.subscribeAddressBatch(addressList);
        requireActiveOwnership(state, options.isActive);

        for (const addr of batch) {
          if (!batchStatuses.has(addr.address)) continue;
          state.subscribedAddresses.add(addr.address);
          statuses.set(addr.address, batchStatuses.get(addr.address) ?? null);
        }

        log.debug(`Subscribed batch ${Math.floor(i / SUBSCRIPTION_BATCH_SIZE) + 1} on ${network}`, {
          count: batch.length,
        });
      } catch (error) {
        if (error instanceof SubscriptionOwnershipChangedError) throw error;
        requireActiveOwnership(state, options.isActive);
        log.error(`Failed to subscribe address batch on ${network}`, {
          error: getErrorMessage(error),
          startIndex: i,
        });

        // Try individual subscriptions as fallback
        for (const addr of batch) {
          try {
            requireActiveOwnership(state, options.isActive);
            const status = await client.subscribeAddress(addr.address);
            requireActiveOwnership(state, options.isActive);
            state.subscribedAddresses.add(addr.address);
            statuses.set(addr.address, status);
          } catch (individualError) {
            if (individualError instanceof SubscriptionOwnershipChangedError) {
              throw individualError;
            }
            requireActiveOwnership(state, options.isActive);
            log.warn(`Failed to subscribe individual address on ${network}`, {
              address: addr.address,
              error: getErrorMessage(individualError),
            });
          }
        }
      }
    }
    requireActiveOwnership(state, options.isActive);
    if (statuses.size > 0) {
      await options.observeStatuses?.(network, statuses);
    }
    if (options.deferBaselineRelease) {
      attachSubscriptionBaseline(statuses, baseline);
      baselineDeferred = true;
    }
    return statuses;
  } finally {
    if (!baselineDeferred) releaseSubscriptionBaseline(baseline);
  }
}

export async function subscribeAddressBatch(
  state: NetworkState,
  addresses: Array<{ address: string; walletId: string }>,
  options: SubscriptionExecutionOptions = {},
): Promise<Map<string, string | null>> {
  const previous = subscriptionOperationTails.get(state) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const tail = previous.then(() => turn);
  subscriptionOperationTails.set(state, tail);
  await previous;

  let releaseDeferred = false;
  const releaseOperation = () => {
    releaseTurn();
    if (subscriptionOperationTails.get(state) === tail) {
      subscriptionOperationTails.delete(state);
    }
  };
  try {
    const statuses = await executeSubscriptionAddressBatch(state, addresses, options);
    if (options.deferBaselineRelease) {
      releaseSubscriptionOperationWithBaseline(statuses, releaseOperation);
      releaseDeferred = true;
    }
    return statuses;
  } finally {
    if (!releaseDeferred) releaseOperation();
  }
}

/**
 * Subscribe to new addresses for a wallet (call when wallet is created or addresses generated).
 */
export async function subscribeWalletAddresses(
  walletId: string,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, AddressWalletInfo>,
  isActive?: () => boolean,
  observeStatuses?: (
    network: BitcoinNetwork,
    statuses: Map<string, string | null>,
  ) => Promise<void>,
): Promise<void> {
  requireActiveOwnership(undefined, isActive);
  const walletNetwork = await walletRepository.findNetwork(walletId);
  requireActiveOwnership(undefined, isActive);

  if (!walletNetwork) return;

  const network = resolvePersistedBitcoinNetwork(walletNetwork);
  const state = networks.get(network);

  if (!state?.connected) {
    log.warn(`Cannot subscribe wallet addresses - ${network} not connected`);
    return;
  }

  const addressStrings = await addressRepository.findAddressStrings(walletId);
  requireActiveOwnership(state, isActive);

  const addressData = addressStrings.map(address => ({
    address,
    walletId,
  }));

  // Update tracking
  for (const addr of addressData) {
    addressToWallet.set(getAddressSubscriptionKey(network, addr.address), {
      walletId,
      network,
    });
  }

  await subscribeAddressBatch(state, addressData, { isActive, observeStatuses });
  requireActiveOwnership(state, isActive);
}

/**
 * Unsubscribe addresses for a wallet (call when wallet is deleted).
 */
export function unsubscribeWalletAddresses(
  walletId: string,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, AddressWalletInfo>
): void {
  for (const [key, info] of addressToWallet) {
    if (info.walletId === walletId) {
      const address = getAddressFromSubscriptionKey(key);
      addressToWallet.delete(key);

      const state = networks.get(info.network);
      if (state) {
        state.subscribedAddresses.delete(address);
      }
    }
  }
}
