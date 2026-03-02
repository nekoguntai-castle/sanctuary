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
let reconnectTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

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
    log.error('GATEWAY_SECRET not configured, cannot connect to backend WebSocket');
    scheduleReconnect();
    return;
  }

  const wsUrl = `${config.backendWsUrl}/gateway`;
  log.info('Connecting to backend WebSocket', { url: wsUrl });

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    log.info('Connected to backend WebSocket, waiting for auth challenge');
  });

  ws.on('message', (data) => {
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

        ws?.send(JSON.stringify({
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
        handleEvent(message.event as BackendEvent);
      }
    } catch (err) {
      log.error('Error parsing WebSocket message', { error: (err as Error).message });
    }
  });

  ws.on('close', (code, reason) => {
    log.warn('Backend WebSocket closed', { code, reason: reason.toString() });
    ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
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
 * Start the backend events service
 */
export function startBackendEvents(): void {
  isShuttingDown = false;
  connect();
}

/**
 * Stop the backend events service
 */
export function stopBackendEvents(): void {
  isShuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  log.info('Backend events service stopped');
}
