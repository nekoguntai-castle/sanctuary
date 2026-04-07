/**
 * WebSocket Server Initialization and Exports
 *
 * This module provides:
 * - Initialization functions for WebSocket servers
 * - Singleton management for server instances
 * - Re-exports of types and classes for external use
 *
 * ## Server Types
 *
 * 1. **Client WebSocket Server** (/ws)
 *    - Browser client connections with JWT authentication
 *    - Channel subscriptions for real-time updates
 *    - Rate limiting and backpressure handling
 *
 * 2. **Gateway WebSocket Server** (/gateway)
 *    - Push notification gateway connection
 *    - HMAC challenge-response authentication (SEC-001)
 *    - Single connection with automatic replacement
 */

import { SanctauryWebSocketServer, getRateLimitEvents } from './clientServer';
import { GatewayWebSocketServer } from './gatewayServer';
import { redisBridge } from './redisBridge';
import { createLogger } from '../utils/logger';

// Re-export types for external use
export type {
  RateLimitEvent,
  AuthenticatedWebSocket,
  WebSocketMessage,
  WebSocketEvent,
  GatewayWebSocket,
} from './types';

// Re-export typed events for gradual migration
export type { ClientMessage, BroadcastEvent, ServerEvent } from './events';

// Re-export classes for type checking
export { SanctauryWebSocketServer } from './clientServer';
export { GatewayWebSocketServer } from './gatewayServer';

// Re-export rate limit event getter
export { getRateLimitEvents };

const log = createLogger('WS:SERVER');

// ============================================================================
// Client WebSocket Server Singleton
// ============================================================================

let wsServer: SanctauryWebSocketServer | null = null;

/**
 * Initialize the client WebSocket server
 *
 * Sets up the server and configures Redis bridge for cross-instance broadcasting.
 * Must be called before getWebSocketServer().
 *
 * @throws Error if server is already initialized
 */
export const initializeWebSocketServer = (): SanctauryWebSocketServer => {
  if (wsServer) {
    throw new Error('WebSocket server already initialized');
  }
  wsServer = new SanctauryWebSocketServer();

  // Set up Redis bridge handler for cross-instance broadcasts
  // When events arrive from other instances via Redis, broadcast locally
  redisBridge.setBroadcastHandler((event) => {
    // wsServer is assigned immediately before this handler is registered.
    wsServer!.localBroadcast(event);
  });

  log.info('Client WebSocket server initialized');
  return wsServer;
};

/**
 * Get the client WebSocket server instance
 *
 * @throws Error if server is not initialized
 */
export const getWebSocketServer = (): SanctauryWebSocketServer => {
  if (!wsServer) {
    throw new Error('WebSocket server not initialized');
  }
  return wsServer;
};

/**
 * Get the client WebSocket server if it has been initialized.
 *
 * Returns null instead of throwing so background-only processes can treat
 * websocket broadcasting as optional.
 */
export const getWebSocketServerIfInitialized = (): SanctauryWebSocketServer | null => {
  return wsServer;
};

// ============================================================================
// Gateway WebSocket Server Singleton
// ============================================================================

let gatewayWsServer: GatewayWebSocketServer | null = null;

/**
 * Initialize the gateway WebSocket server
 *
 * Must be called before getGatewayWebSocketServer().
 *
 * @throws Error if server is already initialized
 */
export const initializeGatewayWebSocketServer = (): GatewayWebSocketServer => {
  if (gatewayWsServer) {
    throw new Error('Gateway WebSocket server already initialized');
  }
  gatewayWsServer = new GatewayWebSocketServer();

  log.info('Gateway WebSocket server initialized');
  return gatewayWsServer;
};

/**
 * Get the gateway WebSocket server instance
 *
 * Returns null if not initialized (gateway is optional).
 */
export const getGatewayWebSocketServer = (): GatewayWebSocketServer | null => {
  return gatewayWsServer;
};
