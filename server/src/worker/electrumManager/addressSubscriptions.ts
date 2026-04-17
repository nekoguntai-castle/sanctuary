/**
 * Address Subscriptions
 *
 * Manages subscribing and unsubscribing wallet addresses to/from
 * Electrum servers with cursor-based pagination for large deployments.
 */

import { walletRepository, addressRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { SUBSCRIPTION_BATCH_SIZE } from './types';
import type { BitcoinNetwork, NetworkState } from './types';

const log = createLogger('WORKER:ELECTRUM_ADDR');

/**
 * Subscribe to all wallet addresses across all networks.
 *
 * Uses cursor-based pagination to handle large numbers of addresses
 * without loading everything into memory at once.
 */
export async function subscribeAllAddresses(
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>
): Promise<void> {
  log.info('Subscribing to all wallet addresses...');

  const PAGE_SIZE = 1000;
  let totalProcessed = 0;
  let cursor: string | undefined;

  // Process addresses in pages to avoid memory issues with large deployments
  while (true) {
    const addresses = await addressRepository.findAllWithWalletNetworkPaginated({
      take: PAGE_SIZE,
      cursor,
    });

    if (addresses.length === 0) break;

    // Group by network for this batch
    const byNetwork = new Map<BitcoinNetwork, Array<{ address: string; walletId: string }>>();

    for (const addr of addresses) {
      const network = (addr.wallet.network || 'mainnet') as BitcoinNetwork;

      if (!byNetwork.has(network)) {
        byNetwork.set(network, []);
      }
      byNetwork.get(network)!.push({
        address: addr.address,
        walletId: addr.walletId,
      });

      // Track address -> wallet mapping
      addressToWallet.set(addr.address, {
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

      await subscribeAddressBatch(state, networkAddresses);
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
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>
): Promise<void> {
  const state = networks.get(network);
  if (!state?.connected) return;

  // Get addresses for this network from our tracking
  const networkAddresses: Array<{ address: string; walletId: string }> = [];

  for (const [address, info] of addressToWallet) {
    if (info.network === network) {
      networkAddresses.push({ address, walletId: info.walletId });
    }
  }

  if (networkAddresses.length > 0) {
    await subscribeAddressBatch(state, networkAddresses);
  }
}

/**
 * Subscribe to a batch of addresses on a specific network.
 */
export async function subscribeAddressBatch(
  state: NetworkState,
  addresses: Array<{ address: string; walletId: string }>
): Promise<void> {
  const { client, network } = state;

  // Filter out already subscribed addresses
  const toSubscribe = addresses.filter(a => !state.subscribedAddresses.has(a.address));

  if (toSubscribe.length === 0) {
    log.debug(`No new addresses to subscribe for ${network}`);
    return;
  }

  log.info(`Subscribing to ${toSubscribe.length} addresses on ${network}`);

  // Subscribe in batches
  for (let i = 0; i < toSubscribe.length; i += SUBSCRIPTION_BATCH_SIZE) {
    const batch = toSubscribe.slice(i, i + SUBSCRIPTION_BATCH_SIZE);
    const addressList = batch.map(a => a.address);

    try {
      await client.subscribeAddressBatch(addressList);

      for (const addr of batch) {
        state.subscribedAddresses.add(addr.address);
      }

      log.debug(`Subscribed batch ${Math.floor(i / SUBSCRIPTION_BATCH_SIZE) + 1} on ${network}`, {
        count: batch.length,
      });
    } catch (error) {
      log.error(`Failed to subscribe address batch on ${network}`, {
        error: getErrorMessage(error),
        startIndex: i,
      });

      // Try individual subscriptions as fallback
      for (const addr of batch) {
        try {
          await client.subscribeAddress(addr.address);
          state.subscribedAddresses.add(addr.address);
        } catch (individualError) {
          log.warn(`Failed to subscribe individual address on ${network}`, {
            address: addr.address,
            error: getErrorMessage(individualError),
          });
        }
      }
    }
  }
}

/**
 * Subscribe to new addresses for a wallet (call when wallet is created or addresses generated).
 */
export async function subscribeWalletAddresses(
  walletId: string,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>
): Promise<void> {
  const walletNetwork = await walletRepository.findNetwork(walletId);

  if (!walletNetwork) return;

  /* v8 ignore next -- walletNetwork fallback is defensive after early return */
  const network = (walletNetwork || 'mainnet') as BitcoinNetwork;
  const state = networks.get(network);

  if (!state?.connected) {
    log.warn(`Cannot subscribe wallet addresses - ${network} not connected`);
    return;
  }

  const addressStrings = await addressRepository.findAddressStrings(walletId);

  const addressData = addressStrings.map(address => ({
    address,
    walletId,
  }));

  // Update tracking
  for (const addr of addressData) {
    addressToWallet.set(addr.address, { walletId, network });
  }

  await subscribeAddressBatch(state, addressData);
}

/**
 * Unsubscribe addresses for a wallet (call when wallet is deleted).
 */
export function unsubscribeWalletAddresses(
  walletId: string,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>
): void {
  for (const [address, info] of addressToWallet) {
    if (info.walletId === walletId) {
      addressToWallet.delete(address);

      const state = networks.get(info.network);
      if (state) {
        state.subscribedAddresses.delete(address);
      }
    }
  }
}
