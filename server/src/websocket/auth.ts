/**
 * WebSocket Authentication
 *
 * Handles JWT verification for WebSocket connections.
 * Supports authentication via:
 * - Authorization header (preferred)
 * - Query parameter (deprecated, backwards compatibility)
 * - Auth message after connection (most secure)
 */

import { IncomingMessage } from 'http';
import { verifyToken } from '../utils/jwt';
import { createLogger } from '../utils/logger';
import {
  AUTH_TIMEOUT_MS,
  MAX_WEBSOCKET_PER_USER,
  AuthenticatedWebSocket,
} from './types';

const log = createLogger('WS_AUTH');

/**
 * Callback interface for auth operations that need to interact with the server
 */
export interface AuthCallbacks {
  /** Track a per-user connection */
  trackUserConnection(userId: string, client: AuthenticatedWebSocket): void;
  /** Get the current set of connections for a user */
  getUserConnections(userId: string): Set<AuthenticatedWebSocket> | undefined;
  /** Complete client registration after successful auth */
  completeClientRegistration(client: AuthenticatedWebSocket): void;
  /** Send a message to the client */
  sendToClient(client: AuthenticatedWebSocket, message: unknown): boolean;
}

/**
 * Extract JWT token from request
 *
 * SECURITY NOTE: Token in query parameter is supported for backwards compatibility
 * but is discouraged. The frontend client uses 'auth' message after connection instead.
 * Query parameter support may be removed in a future version.
 */
export function extractToken(request: IncomingMessage): string | null {
  // Try Authorization header first (preferred)
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Fallback to query parameter (deprecated - avoid using in new code)
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam) {
    log.debug('Client using deprecated query parameter auth');
    return tokenParam;
  }

  return null;
}

/**
 * Authenticate a connection using a token provided at upgrade time
 *
 * If token is present, verifies it asynchronously and completes registration on success.
 * If no token, sets up an auth timeout and completes registration immediately.
 *
 * @returns true if auth is being handled asynchronously (caller should not register),
 *          false if no token was found (caller should register synchronously)
 */
export function authenticateOnUpgrade(
  client: AuthenticatedWebSocket,
  request: IncomingMessage,
  callbacks: AuthCallbacks
): boolean {
  const token = extractToken(request);

  log.info(`WebSocket connection attempt from ${request.socket.remoteAddress}`);

  if (token) {
    verifyToken(token)
      .then((decoded) => {
        client.userId = decoded.userId;

        // Check per-user connection limit
        const userConnections = callbacks.getUserConnections(client.userId);
        if (userConnections && userConnections.size >= MAX_WEBSOCKET_PER_USER) {
          log.warn(`Connection rejected for user ${client.userId}: per-user limit of ${MAX_WEBSOCKET_PER_USER} reached`);
          client.close(1008, `User connection limit of ${MAX_WEBSOCKET_PER_USER} reached`);
          return;
        }

        log.info(`WebSocket client authenticated: ${client.userId}`);

        // Track per-user connection
        callbacks.trackUserConnection(client.userId, client);

        // Complete client registration
        callbacks.completeClientRegistration(client);
      })
      .catch((err) => {
        log.error('WebSocket authentication failed', { error: String(err) });
        client.close(1008, 'Authentication failed');
      });
    return true; // Async auth in progress
  }

  // No token - set up auth timeout
  log.debug('WebSocket client connected without authentication');
  client.authTimeout = setTimeout(() => {
    if (!client.userId) {
      log.debug('Closing unauthenticated connection due to timeout');
      client.closeReason = 'auth_timeout';
      client.close(4001, 'Authentication timeout');
    }
  }, AUTH_TIMEOUT_MS);

  return false; // No async auth, caller should register synchronously
}

/**
 * Handle authentication via message (more secure than URL token)
 */
export async function handleAuthMessage(
  client: AuthenticatedWebSocket,
  data: { token: string },
  callbacks: AuthCallbacks
): Promise<void> {
  const { token } = data;

  // Don't allow re-authentication
  if (client.userId) {
    callbacks.sendToClient(client, {
      type: 'authenticated',
      data: { success: true, userId: client.userId, message: 'Already authenticated' },
    });
    return;
  }

  try {
    const decoded = await verifyToken(token);
    const userId = decoded.userId;

    // Check per-user connection limit
    const userConnections = callbacks.getUserConnections(userId);
    if (userConnections && userConnections.size >= MAX_WEBSOCKET_PER_USER) {
      log.warn(`Authentication rejected for user ${userId}: per-user limit of ${MAX_WEBSOCKET_PER_USER} reached`);
      callbacks.sendToClient(client, {
        type: 'error',
        data: { message: `User connection limit of ${MAX_WEBSOCKET_PER_USER} reached` },
      });
      client.close(1008, `User connection limit of ${MAX_WEBSOCKET_PER_USER} reached`);
      return;
    }

    client.userId = userId;
    log.debug(`WebSocket client authenticated via message: ${client.userId}`);

    // Track per-user connection
    callbacks.trackUserConnection(userId, client);

    // Clear authentication timeout
    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = undefined;
    }

    callbacks.sendToClient(client, {
      type: 'authenticated',
      data: { success: true, userId: client.userId },
    });
  } catch (err) {
    log.error('WebSocket authentication failed', { error: String(err) });
    callbacks.sendToClient(client, {
      type: 'error',
      data: { message: 'Authentication failed' },
    });
  }
}
