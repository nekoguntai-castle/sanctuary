/**
 * Network Connection
 *
 * Handles connecting to Electrum servers, subscribing to block headers,
 * and setting up event handlers for a specific network.
 */

import { getElectrumClientForNetwork } from '../../services/bitcoin/electrum';
import { hashBlockHeader, previousBlockHashFromHeader } from '../../services/bitcoin/networkIdentity';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import {
  type AddressWalletInfo,
  type BitcoinNetwork,
  type NetworkState,
  type ElectrumManagerCallbacks,
} from './types';
import {
  bufferSubscriptionNotification,
  markSubscriptionResponse,
} from './subscriptionBaselines';

const log = createLogger('WORKER:ELECTRUM_NET');
type HeaderObservation = { height: number; hex: string };
const pendingLiveHeaders = new WeakMap<NetworkState, HeaderObservation | null>();
const activeClientStates = new WeakMap<NetworkState['client'], NetworkState>();
interface LiveHeaderPump {
  pending: HeaderObservation | null;
  running: boolean;
}
const liveHeaderPumps = new WeakMap<NetworkState, LiveHeaderPump>();

function isActiveClientState(state: NetworkState): boolean {
  return activeClientStates.get(state.client) === state;
}

function detachEventHandlers(state: NetworkState): void {
  for (const event of ['newBlock', 'addressActivity', 'subscriptionResponse', 'close', 'error']) {
    state.client.removeAllListeners(event);
  }
}

function queueLatestLiveHeader(
  state: NetworkState,
  block: HeaderObservation,
  observe: (block: HeaderObservation) => Promise<void>,
): void {
  // Intermediate notifications may be coalesced because reconciliation walks
  // every parent-linked height from its durable cursor to the newest target.
  const pump = liveHeaderPumps.get(state) ?? { pending: null, running: false };
  liveHeaderPumps.set(state, pump);
  pump.pending = block;
  if (pump.running) return;
  pump.running = true;
  void (async () => {
    try {
      while (pump.pending && isActiveClientState(state)) {
        const next = pump.pending;
        pump.pending = null;
        await observe(next);
      }
    } finally {
      pump.running = false;
      liveHeaderPumps.delete(state);
    }
  })();
}

async function observeLiveHeader(
  state: NetworkState,
  callbacks: ElectrumManagerCallbacks,
  block: HeaderObservation,
  isRunning: () => boolean,
): Promise<void> {
  await callbacks.onHeaderObservation(
    state.network,
    block,
    (startHeight, count) => state.client.getBlockHeaders(startHeight, count),
  );
  if (!isRunning()) return;
  state.lastBlockHeight = block.height;
  log.info(`Observed ${state.network} block at height ${block.height}`);
}

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
    if (!isRunning()) {
      client.disconnect();
      return;
    }

    // Negotiate protocol version
    try {
      const version = await client.getServerVersion();
      if (!isRunning()) {
        client.disconnect();
        return;
      }
      log.info(`Connected to Electrum ${network}: ${version.server} (protocol ${version.protocol})`);
    } catch (versionError) {
      if (!isRunning()) {
        client.disconnect();
        return;
      }
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

    // Install listeners before subscribing so a notification racing the
    // subscription response cannot fall into an unobserved window.
    setupEventHandlers(state, addressToWallet, callbacks, isRunning, scheduleReconnect);

    // Subscribe to headers and route the returned current tip through the same
    // durable reconciliation boundary as later notifications.
    await subscribeHeaders(state, callbacks, isRunning);
    if (!isRunning()) {
      if (networks.get(network) === state) networks.delete(network);
      client.disconnect();
      return;
    }

    log.info(`Electrum ${network} connected and subscribed`);
  } catch (error) {
    log.error(`Failed to connect to Electrum ${network}`, {
      error: getErrorMessage(error),
    });
    if (isRunning()) scheduleReconnect(network);
  }
}

/**
 * Subscribe to block headers for a network.
 */
export async function subscribeHeaders(
  state: NetworkState,
  callbacks: ElectrumManagerCallbacks,
  isRunning: () => boolean = () => true,
): Promise<void> {
  if (state.subscribedToHeaders) return;
  if (!isRunning()) {
    state.client.disconnect();
    return;
  }

  try {
    const header = await state.client.subscribeHeaders();
    if (!isRunning()) {
      state.client.disconnect();
      return;
    }
    await callbacks.onHeaderObservation(
      state.network,
      { height: header.height, hex: header.hex },
      (startHeight, count) => state.client.getBlockHeaders(startHeight, count),
    );
    if (!isRunning()) {
      state.client.disconnect();
      return;
    }
    state.lastBlockHeight = header.height;
    const buffered = pendingLiveHeaders.get(state);
    pendingLiveHeaders.set(state, null);
    if (buffered) {
      await observeLiveHeader(state, callbacks, buffered, isRunning);
      if (!isRunning()) {
        state.client.disconnect();
        return;
      }
    }
    const deferred = pendingLiveHeaders.get(state);
    pendingLiveHeaders.delete(state);
    state.subscribedToHeaders = true;
    if (deferred) state.client.emit('newBlock', deferred);

    log.info(`Subscribed to ${state.network} headers, current height: ${header.height}`);
  } catch (error) {
    pendingLiveHeaders.delete(state);
    if (!isActiveClientState(state)) return;
    detachEventHandlers(state);
    activeClientStates.delete(state.client);
    if (!isRunning()) {
      state.client.disconnect();
      return;
    }
    log.error(`Failed to subscribe to ${state.network} headers`, {
      error: getErrorMessage(error),
    });
    state.connected = false;
    state.client.disconnect();
    throw error;
  }
}

/**
 * Set up event handlers for a network client.
 */
export function setupEventHandlers(
  state: NetworkState,
  _addressToWallet: Map<string, AddressWalletInfo>,
  callbacks: ElectrumManagerCallbacks,
  isRunning: () => boolean,
  scheduleReconnect: (network: BitcoinNetwork) => void
): void {
  const { client, network } = state;
  detachEventHandlers(state);
  activeClientStates.set(client, state);
  if (!state.subscribedToHeaders) pendingLiveHeaders.set(state, null);

  // Handle new blocks
  client.on('newBlock', (block: { height: number; hex: string }) => {
    if (!isRunning()) return;

    try {
      hashBlockHeader(block.hex);
      previousBlockHashFromHeader(block.hex);
    } catch (error) {
      log.warn(`Discarding malformed ${network} block header at height ${block.height}`, {
        reason: getErrorMessage(error, 'Unknown error'),
      });
      return;
    }

    if (pendingLiveHeaders.has(state)) {
      pendingLiveHeaders.set(state, block);
      return;
    }
    queueLatestLiveHeader(state, block, async next => {
      try {
        await observeLiveHeader(state, callbacks, next, isRunning);
      } catch (error) {
        if (!isActiveClientState(state)) return;
        log.error(`Failed to reconcile ${network} block header at height ${next.height}`, {
          error: getErrorMessage(error),
        });
        state.connected = false;
        state.subscribedToHeaders = false;
        state.subscribedAddresses.clear();
        pendingLiveHeaders.delete(state);
        detachEventHandlers(state);
        activeClientStates.delete(client);
        client.disconnect();
        if (isRunning()) scheduleReconnect(network);
      }
    });
  });

  // Handle address activity
  client.on('addressActivity', (activity: {
    scriptHash: string;
    address?: string;
    status: string | null;
    sequence?: number;
  }) => {
    if (!isRunning()) return;
    if (bufferSubscriptionNotification(state, activity)) return;
    log.info(`Address activity on ${network}`, { scriptHash: activity.scriptHash });
    callbacks.onAddressActivity(network, activity.scriptHash, activity.status);
  });

  client.on('subscriptionResponse', (response: { address: string; sequence: number }) => {
    if (!isRunning()) return;
    markSubscriptionResponse(state, response.address, response.sequence);
  });

  // Handle connection close
  client.on('close', () => {
    log.warn(`Electrum ${network} connection closed`);
    state.connected = false;
    state.subscribedToHeaders = false;
    state.subscribedAddresses.clear();
    pendingLiveHeaders.delete(state);
    detachEventHandlers(state);
    activeClientStates.delete(client);

    if (isRunning()) {
      scheduleReconnect(network);
    }
  });

  // Handle errors
  client.on('error', (error: Error) => {
    log.error(`Electrum ${network} error`, { error: error.message });
  });
}
