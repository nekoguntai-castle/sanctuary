/**
 * Backend Events Service
 *
 * This service is a core component of the Gateway's push notification system.
 * It maintains a WebSocket connection to the backend server to receive real-time
 * transaction events, then translates those into push notifications for mobile devices.
 *
 * ## Architecture
 *
 * ```
 * [Backend] --WebSocket--> [Gateway] --FCM/APNs--> [Mobile Apps]
 *     |                        |
 *     |                        +-- Fetches device tokens via HTTP
 *     |
 *     +-- Emits events when transactions occur
 * ```
 *
 * ## Authentication (SEC-001)
 *
 * Uses HMAC challenge-response authentication instead of JWT secret sharing:
 * 1. Backend sends challenge on connect
 * 2. Gateway responds with HMAC-SHA256(challenge, GATEWAY_SECRET)
 * 3. Backend verifies and grants access
 *
 * ## Reconnection
 *
 * The service automatically reconnects on disconnect with a 5-second delay.
 */

import WebSocket from 'ws';
import { createHmac } from 'crypto';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';
import { handleEvent } from './eventHandler';
import type { BackendEvent } from './types';

const log = createLogger('BACKEND_EVENTS');

let ws: WebSocket | null = null;
// The backend pings the gateway every 30s (gatewayServer heartbeat). Without one
// for this long the connection is half-open: drop it so reconnect takes over.
export const BACKEND_HEARTBEAT_TIMEOUT_MS = 75_000;
let heartbeatWatchdog: NodeJS.Timeout | null = null;

function clearHeartbeatWatchdog(): void {
  if (heartbeatWatchdog) {
    clearTimeout(heartbeatWatchdog);
    heartbeatWatchdog = null;
  }
}

function armHeartbeatWatchdog(socket: WebSocket): void {
  clearHeartbeatWatchdog();
  heartbeatWatchdog = setTimeout(() => {
    heartbeatWatchdog = null;
    if (ws !== socket) return;
    log.warn('No heartbeat from backend WebSocket; reconnecting');
    socket.terminate();
  }, BACKEND_HEARTBEAT_TIMEOUT_MS);
}
let reconnectTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
// A stop owns the drain promise. A start during that drain records one deferred
// restart, while another stop cancels it. Accepted event promises remain here
// until settled so shutdown can await the exact admitted set.
let pendingStop: Promise<void> | null = null;
let restartAfterStop = false;
const inFlightEvents = new Set<Promise<void>>();

const RECONNECT_DELAY = 5000; // 5 seconds

/**
 * Connect to backend WebSocket
 *
 * SEC-001: Uses HMAC challenge-response authentication instead of JWT secret sharing.
 */
function connect(): void {
  if (isShuttingDown) return;

  // Check if gateway secret is configured
  if (!config.gatewaySecret) {
    // The secret is read once at startup, so a retry cannot succeed. Report it
    // once and stop; push delivery stays off until the gateway is restarted
    // with the secret set.
    log.error('GATEWAY_SECRET not configured, cannot connect to backend WebSocket; push delivery is disabled');
    return;
  }

  const wsUrl = `${config.backendWsUrl}/gateway`;
  log.info('Connecting to backend WebSocket', { url: wsUrl });

  const socket = new WebSocket(wsUrl);
  ws = socket;

  socket.on('open', () => {
    log.info('Connected to backend WebSocket, waiting for auth challenge');
    armHeartbeatWatchdog(socket);
  });

  socket.on('ping', () => {
    if (ws === socket) armHeartbeatWatchdog(socket);
  });

  socket.on('message', (data) => {
    // Ignore buffered callbacks from a socket that shutdown or restart retired.
    if (ws !== socket || isShuttingDown) {
      return;
    }

    try {
      const message = JSON.parse(data.toString());

      // SEC-001: Handle HMAC challenge-response authentication
      if (message.type === 'auth_challenge') {
        const challenge = message.challenge;
        if (!challenge) {
          log.error('Received auth_challenge without challenge data');
          return;
        }

        // Generate HMAC response
        const response = createHmac('sha256', config.gatewaySecret)
          .update(challenge)
          .digest('hex');

        socket.send(JSON.stringify({
          type: 'auth_response',
          response,
        }));

        log.debug('Sent auth response to backend');
        return;
      }

      if (message.type === 'auth_success') {
        log.info('Gateway authenticated with backend (HMAC challenge-response)');
        return;
      }

      if (message.type === 'event') {
        let trackedEvent!: Promise<void>;
        trackedEvent = Promise.resolve()
          .then(() => handleEvent(message.event as BackendEvent))
          .catch((error: unknown) => {
            log.error('Error handling backend event', {
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            inFlightEvents.delete(trackedEvent);
          });
        inFlightEvents.add(trackedEvent);
      }
    } catch (err) {
      log.error('Error parsing WebSocket message', { error: (err as Error).message });
    }
  });

  socket.on('close', (code, reason) => {
    log.warn('Backend WebSocket closed', { code, reason: reason.toString() });
    // A superseded socket cannot clear or reconnect over the active owner.
    if (ws !== socket) {
      return;
    }
    ws = null;
    clearHeartbeatWatchdog();
    scheduleReconnect();
  });

  socket.on('error', (err) => {
    log.error('Backend WebSocket error', { error: err.message });
  });
}

/**
 * Schedule reconnection attempt
 */
function scheduleReconnect(): void {
  if (isShuttingDown || reconnectTimer) return;

  log.info(`Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY);
}

/**
 * Start the backend events service. If a prior stop is still draining, one
 * restart is deferred until that drain settles.
 */
export function startBackendEvents(): void {
  if (pendingStop) {
    if (!restartAfterStop) {
      restartAfterStop = true;
      void pendingStop.then(() => {
        if (!restartAfterStop) {
          return;
        }
        restartAfterStop = false;
        isShuttingDown = false;
        connect();
      });
    }
    return;
  }

  isShuttingDown = false;
  connect();
}

/**
 * Stop accepting events and resolve after all previously accepted work settles.
 * Concurrent callers share the same drain.
 */
export function stopBackendEvents(): Promise<void> {
  isShuttingDown = true;
  restartAfterStop = false;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearHeartbeatWatchdog();

  if (ws) {
    const socket = ws;
    ws = null;
    socket.close();
  }

  if (pendingStop) {
    return pendingStop;
  }

  const acceptedEvents = [...inFlightEvents];
  const drain = Promise.allSettled(acceptedEvents).then(() => {
    log.info('Backend events service stopped');
  });
  let trackedStop!: Promise<void>;
  trackedStop = drain.finally(() => {
    if (pendingStop === trackedStop) {
      pendingStop = null;
    }
  });
  pendingStop = trackedStop;
  return trackedStop;
}
