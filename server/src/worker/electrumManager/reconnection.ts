/**
 * Reconnection Logic
 *
 * Exponential backoff reconnection scheduling for lost Electrum connections.
 */

import { getElectrumClientForNetwork } from '../../services/bitcoin/electrum';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import {
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
} from './types';
import type { BitcoinNetwork, NetworkState, ElectrumManagerCallbacks } from './types';
import { connectNetwork } from './networkConnection';

const log = createLogger('WORKER:ELECTRUM_RECONNECT');

/**
 * Schedule a reconnection attempt with exponential backoff.
 */
export function scheduleReconnect(
  network: BitcoinNetwork,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>,
  callbacks: ElectrumManagerCallbacks,
  isRunning: () => boolean,
  subscribeNetworkAddresses: (network: BitcoinNetwork) => Promise<void>,
  connectNetworkAttempt?: (network: BitcoinNetwork) => Promise<void>,
): void {
  const state = networks.get(network);

  // Clear any existing timer
  if (state?.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
  }

  // Calculate delay with exponential backoff
  const attempts = state?.reconnectAttempts ?? 0;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(2, attempts),
    RECONNECT_MAX_DELAY_MS
  );

  if (attempts >= RECONNECT_MAX_ATTEMPTS) {
    log.error(`Electrum ${network} reconnection attempts exceeded ${RECONNECT_MAX_ATTEMPTS}, continuing to try...`);
  }

  log.info(`Scheduling Electrum ${network} reconnection in ${delay}ms (attempt ${attempts + 1})`);

  // Create a bound scheduleReconnect for passing to connectNetwork
  const boundScheduleReconnect = (net: BitcoinNetwork) =>
    scheduleReconnect(
      net,
      networks,
      addressToWallet,
      callbacks,
      isRunning,
      subscribeNetworkAddresses,
      connectNetworkAttempt,
    );

  const timer = setTimeout(async () => {
    if (!isRunning()) return;
    try {
      // Update state
      if (state) {
        state.reconnectTimer = null;
        state.reconnectAttempts++;
      }

      // Attempt reconnection
      if (connectNetworkAttempt) {
        await connectNetworkAttempt(network);
      } else {
        await connectNetwork(
          network,
          networks,
          addressToWallet,
          callbacks,
          isRunning,
          boundScheduleReconnect,
        );
      }
      if (!isRunning()) return;

      // Re-subscribe addresses if connected. A failed checkpoint persistence is
      // retried by the bounded status-refresh loop and must not escape the timer.
      const currentState = networks.get(network);
      if (currentState?.connected) {
        // Reset only after the resubscribe itself succeeds, so a repeatedly
        // failing resubscribe keeps growing reconnectAttempts and the
        // re-armed backoff below stays exponential instead of retrying at
        // the base delay forever.
        await subscribeNetworkAddresses(network);
        currentState.reconnectAttempts = 0;
      }
    } catch (error) {
      // connectNetworkAttempt/connectNetwork always catch and self-schedule
      // their own reconnect internally, so any error reaching here comes
      // from subscribeNetworkAddresses after a successful connect. Leaving
      // the network connected with no subscriptions and no timer would sit
      // silently unsubscribed forever, so re-arm the bounded backoff.
      log.error(`Electrum ${network} reconnect restoration failed`, {
        error: getErrorMessage(error),
      });
      if (isRunning()) {
        boundScheduleReconnect(network);
      }
    }
  }, delay);

  if (state) {
    state.reconnectTimer = timer;
  } else {
    // Create minimal state for tracking reconnection
    networks.set(network, {
      network,
      client: getElectrumClientForNetwork(network),
      connected: false,
      subscribedToHeaders: false,
      subscribedAddresses: new Set(),
      lastBlockHeight: 0,
      reconnectTimer: timer,
      reconnectAttempts: attempts + 1,
    });
  }
}
