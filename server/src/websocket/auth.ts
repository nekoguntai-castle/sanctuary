/**
 * WebSocket Authentication
 *
 * Handles JWT verification for WebSocket connections.
 * Supports authentication via:
 * - Authorization header (preferred, used by mobile/gateway callers)
 * - sanctuary_access HttpOnly cookie (browser path, ADR 0001 / 0002)
 * - Auth message after connection (back-compat for legacy clients)
 *
 * The `?token=<jwt>` query-parameter path was removed in Phase 3 of the
 * cookie auth migration (ADR 0001). Query-string tokens leak through
 * referer headers and server-side access logs, so shutting off that entry
 * point closes a known token-exfiltration vector. Same-origin browser
 * WebSocket upgrades now carry the access token in the Cookie header
 * automatically; mobile/gateway callers keep using the Authorization
 * header unchanged.
 */

import { IncomingMessage } from 'http';
import { parse as parseCookieHeader } from 'cookie';
import { verifyToken, TokenAudience, type JWTPayload } from '../utils/jwt';
import { createLogger } from '../utils/logger';
// Import from authCookieNames (zero-import module) rather than csrf so the
// WebSocket upgrade path does NOT transitively load `../config`, which
// runs `getConfig()` at module load and would fail in tests that mock
// jwt but not config.
import { SANCTUARY_ACCESS_COOKIE_NAME } from '../middleware/authCookieNames';
import {
  AUTH_TIMEOUT_MS,
  MAX_WEBSOCKET_PER_USER,
  AuthenticatedWebSocket,
} from './types';

const log = createLogger('WS:AUTH');

/**
 * WebSocket subscriptions require the same access-token boundary as HTTP APIs.
 */
async function verifyWebSocketAccessToken(token: string): Promise<JWTPayload> {
  const decoded = await verifyToken(token, TokenAudience.ACCESS);

  if (decoded.pending2FA) {
    throw new Error('2FA verification required');
  }

  return decoded;
}

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
 * Extract JWT token from a WebSocket upgrade request.
 *
 * Source precedence, matching the HTTP auth middleware in
 * `server/src/middleware/auth.ts`:
 *
 *   1. `Authorization: Bearer <token>` header — mobile/gateway callers
 *      and any client that does not maintain cookies.
 *   2. `sanctuary_access` cookie from the upgrade request's Cookie header
 *      — the browser path. Same-origin WebSocket upgrades automatically
 *      attach cookies set by any prior HTTP response, so the access token
 *      is available here without any frontend code (ADR 0001 / 0002).
 *
 * Returns `null` when neither source is present. The caller then falls
 * back to the auth-message-after-connect path which is kept for legacy
 * clients (Sanctuary's own scripts/perf benchmark uses it).
 *
 * SECURITY: The legacy `?token=<jwt>` query-parameter path was removed
 * in Phase 3 of the cookie auth migration. Query-string tokens leak
 * through referer headers, server access logs, and browser history, so
 * accepting them is a known exfiltration vector. Any client still using
 * that path will now authenticate via the auth message instead.
 */
export function extractToken(request: IncomingMessage): string | null {
  // Authorization header first (mobile/gateway path, preserves existing behavior).
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Fall through to the sanctuary_access cookie (browser path).
  const rawCookieHeader = request.headers.cookie;
  if (typeof rawCookieHeader === 'string' && rawCookieHeader.length > 0) {
    // `cookie.parse` handles quoted values, URL-decoding, and multi-cookie
    // separation per RFC 6265. Do not regex this — token characters and
    // the split semantics are subtle enough to be worth a library call.
    const parsed = parseCookieHeader(rawCookieHeader);
    const cookieToken = parsed[SANCTUARY_ACCESS_COOKIE_NAME];
    if (typeof cookieToken === 'string' && cookieToken.length > 0) {
      return cookieToken;
    }
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
    verifyWebSocketAccessToken(token)
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
    const decoded = await verifyWebSocketAccessToken(token);
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
