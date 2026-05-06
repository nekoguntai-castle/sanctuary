/**
 * Network Connection
 *
 * Handles connecting to Electrum servers, subscribing to block headers,
 * and setting up event handlers for a specific network.
 */

import { getElectrumClientForNetwork } from '../../services/bitcoin/electrum';
import { setCachedBlockHeight } from '../../services/bitcoin/blockchain';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import {
  getAddressSubscriptionKey,
  type AddressWalletInfo,
  type BitcoinNetwork,
  type NetworkState,
  type ElectrumManagerCallbacks,
} from './types';

const log = createLogger('WORKER:ELECTRUM_NET');

/**
 * Connect to a specific network's Electrum server.
 * Creates or reuses a NetworkState, subscribes to headers, and sets up event handlers.
 */
export async function connectNetwork(
  network: BitcoinNetwork,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, AddressWalletInfo>,
  callbacks: ElectrumManagerCallbacks,
  isRunning: () => boolean,
  scheduleReconnect: (network: BitcoinNetwork) => void
): Promise<void> {
  if (networks.has(network)) {
    const state = networks.get(network)!;
    if (state.connected) {
      log.debug(`Already connected to ${network}`);
      return;
    }
  }

  try {
    log.info(`Connecting to Electrum for ${network}...`);

    const client = getElectrumClientForNetwork(network);
    await client.connect();

    // Negotiate protocol version
    try {
      const version = await client.getServerVersion();
      log.info(`Connected to Electrum ${network}: ${version.server} (protocol ${version.protocol})`);
    } catch (versionError) {
      log.warn(`Could not get server version for ${network}, continuing`, {
        error: getErrorMessage(versionError),
      });
    }

    // Create network state
    const state: NetworkState = {
      network,
      client,
      connected: true,
      subscribedToHeaders: false,
      subscribedAddresses: new Set(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    };

    networks.set(network, state);

    // Subscribe to headers
    await subscribeHeaders(state);

    // Set up event handlers
    setupEventHandlers(state, addressToWallet, callbacks, isRunning, scheduleReconnect);

    log.info(`Electrum ${network} connected and subscribed`);
  } catch (error) {
    log.error(`Failed to connect to Electrum ${network}`, {
      error: getErrorMessage(error),
    });
    scheduleReconnect(network);
  }
}

/**
 * Subscribe to block headers for a network.
 */
export async function subscribeHeaders(state: NetworkState): Promise<void> {
  if (state.subscribedToHeaders) return;

  try {
    const header = await state.client.subscribeHeaders();
    state.subscribedToHeaders = true;
    state.lastBlockHeight = header.height;

    // Update cached block height
    setCachedBlockHeight(header.height, state.network);

    log.info(`Subscribed to ${state.network} headers, current height: ${header.height}`);
  } catch (error) {
    log.error(`Failed to subscribe to ${state.network} headers`, {
      error: getErrorMessage(error),
    });
  }
}

/**
 * Set up event handlers for a network client.
 */
export function setupEventHandlers(
  state: NetworkState,
  addressToWallet: Map<string, AddressWalletInfo>,
  callbacks: ElectrumManagerCallbacks,
  isRunning: () => boolean,
  scheduleReconnect: (network: BitcoinNetwork) => void
): void {
  const { client, network } = state;

  // Handle new blocks
  client.on('newBlock', (block: { height: number; hex: string }) => {
    state.lastBlockHeight = block.height;
    setCachedBlockHeight(block.height, network);

    log.info(`New ${network} block at height ${block.height}`);
    callbacks.onNewBlock(network, block.height, block.hex.slice(0, 64));
  });

  // Handle address activity
  client.on('addressActivity', (activity: { scriptHash: string; address?: string; status: string }) => {
    const address = activity.address;
    if (!address) {
      log.warn(`Address activity without resolved address on ${network}`);
      return;
    }

    const walletInfo = addressToWallet.get(
      getAddressSubscriptionKey(network, address),
    );
    if (walletInfo && walletInfo.network === network) {
      log.info(`Address activity on ${network}: ${address} (wallet: ${walletInfo.walletId})`);
      callbacks.onAddressActivity(network, walletInfo.walletId, address);
    } else {
      log.debug(`Address activity for untracked address: ${address}`);
    }
  });

  // Handle connection close
  client.on('close', () => {
    log.warn(`Electrum ${network} connection closed`);
    state.connected = false;
    state.subscribedToHeaders = false;
    state.subscribedAddresses.clear();

    if (isRunning()) {
      scheduleReconnect(network);
    }
  });

  // Handle errors
  client.on('error', (error: Error) => {
    log.error(`Electrum ${network} error`, { error: error.message });
  });
}
