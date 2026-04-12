/**
 * Proxy Route Whitelist
 *
 * Only routes explicitly listed here are proxied to the backend.
 * Everything else is blocked.
 *
 * ## Why Whitelist Instead of Blacklist?
 *
 * A whitelist approach is more secure because:
 * - New endpoints aren't accidentally exposed
 * - Admin/sensitive routes are blocked by default
 * - We explicitly choose what mobile apps can access
 *
 * ## Adding New Routes
 *
 * To expose a new endpoint to mobile apps:
 * 1. Add route metadata to GATEWAY_ROUTE_CONTRACTS below
 * 2. Use regex source strings for dynamic segments (e.g., uuidPattern)
 * 3. Point openApiPath at the matching backend OpenAPI path
 * 4. Consider security implications before adding
 *
 * ## Routes NOT to Expose
 *
 * - Admin routes (`/api/v1/admin/*`)
 * - User management (`DELETE /api/v1/users/*`)
 * - Node configuration (`/api/v1/nodes/*`)
 * - Backup/restore operations
 * - Internal gateway endpoints
 */

import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { logSecurityEvent } from '../../middleware/requestLogger';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type GatewayRouteContract = {
  method: HttpMethod;
  pattern: RegExp;
  samplePath: string;
  openApiPath: string;
};

const uuidPattern = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const txidPattern = '[a-f0-9]{64}';
const sampleUuid = '12345678-1234-1234-1234-123456789abc';
const sampleTxid = 'a'.repeat(64);

function route(
  method: HttpMethod,
  pathPattern: string,
  samplePath: string,
  openApiPath: string
): GatewayRouteContract {
  return {
    method,
    pattern: new RegExp(`^/api/v1${pathPattern}$`),
    samplePath: `/api/v1${samplePath}`,
    openApiPath,
  };
}

/**
 * Whitelist contract for allowed API routes
 *
 * Runtime proxy access is derived from this metadata so tests can validate the
 * same route list against OpenAPI coverage without maintaining a duplicate map.
 *
 * SECURITY: Only add routes that are safe for mobile app access.
 * Admin routes and sensitive operations should NOT be exposed.
 */
export const GATEWAY_ROUTE_CONTRACTS: GatewayRouteContract[] = [
  // Authentication
  route('POST', '/auth/login', '/auth/login', '/auth/login'),
  route('POST', '/auth/refresh', '/auth/refresh', '/auth/refresh'),
  route('POST', '/auth/logout', '/auth/logout', '/auth/logout'),
  route('POST', '/auth/logout-all', '/auth/logout-all', '/auth/logout-all'),
  route('POST', '/auth/2fa/verify', '/auth/2fa/verify', '/auth/2fa/verify'),
  route('GET', '/auth/me', '/auth/me', '/auth/me'),
  route('PATCH', '/auth/me/preferences', '/auth/me/preferences', '/auth/me/preferences'),

  // Session management
  route('GET', '/auth/sessions', '/auth/sessions', '/auth/sessions'),
  route('DELETE', `/auth/sessions/${uuidPattern}`, `/auth/sessions/${sampleUuid}`, '/auth/sessions/{id}'),

  // Wallets (read-only + sync)
  route('GET', '/wallets', '/wallets', '/wallets'),
  route('GET', `/wallets/${uuidPattern}`, `/wallets/${sampleUuid}`, '/wallets/{walletId}'),
  route('POST', `/sync/wallet/${uuidPattern}`, `/sync/wallet/${sampleUuid}`, '/sync/wallet/{walletId}'),

  // Transactions (read-only)
  route('GET', `/wallets/${uuidPattern}/transactions`, `/wallets/${sampleUuid}/transactions`, '/wallets/{walletId}/transactions'),
  // Transaction detail is canonicalized by txid; backend findByTxidWithAccess enforces per-user wallet access.
  route('GET', `/transactions/${txidPattern}`, `/transactions/${sampleTxid}`, '/transactions/{txid}'),

  // Addresses (read-only + generate)
  route('GET', `/wallets/${uuidPattern}/addresses/summary`, `/wallets/${sampleUuid}/addresses/summary`, '/wallets/{walletId}/addresses/summary'),
  route('GET', `/wallets/${uuidPattern}/addresses`, `/wallets/${sampleUuid}/addresses`, '/wallets/{walletId}/addresses'),
  route('POST', `/wallets/${uuidPattern}/addresses/generate`, `/wallets/${sampleUuid}/addresses/generate`, '/wallets/{walletId}/addresses/generate'),

  // UTXOs (read-only)
  route('GET', `/wallets/${uuidPattern}/utxos`, `/wallets/${sampleUuid}/utxos`, '/wallets/{walletId}/utxos'),

  // Labels (read + write)
  route('GET', `/wallets/${uuidPattern}/labels`, `/wallets/${sampleUuid}/labels`, '/wallets/{walletId}/labels'),
  route('POST', `/wallets/${uuidPattern}/labels`, `/wallets/${sampleUuid}/labels`, '/wallets/{walletId}/labels'),
  route('PUT', `/wallets/${uuidPattern}/labels/${uuidPattern}`, `/wallets/${sampleUuid}/labels/${sampleUuid}`, '/wallets/{walletId}/labels/{labelId}'),
  route('DELETE', `/wallets/${uuidPattern}/labels/${uuidPattern}`, `/wallets/${sampleUuid}/labels/${sampleUuid}`, '/wallets/{walletId}/labels/{labelId}'),

  // Bitcoin status
  route('GET', '/bitcoin/status', '/bitcoin/status', '/bitcoin/status'),
  route('GET', '/bitcoin/fees', '/bitcoin/fees', '/bitcoin/fees'),

  // Price
  route('GET', '/price', '/price', '/price'),

  // Pending transactions
  route('GET', '/transactions/pending', '/transactions/pending', '/transactions/pending'),

  // Push notifications (device registration)
  route('POST', '/push/register', '/push/register', '/push/register'),
  route('DELETE', '/push/unregister', '/push/unregister', '/push/unregister'),
  route('GET', '/push/devices', '/push/devices', '/push/devices'),
  route('DELETE', `/push/devices/${uuidPattern}`, `/push/devices/${sampleUuid}`, '/push/devices/{id}'),

  // Transaction building & broadcasting
  route('POST', `/wallets/${uuidPattern}/transactions/create`, `/wallets/${sampleUuid}/transactions/create`, '/wallets/{walletId}/transactions/create'),
  route('POST', `/wallets/${uuidPattern}/transactions/estimate`, `/wallets/${sampleUuid}/transactions/estimate`, '/wallets/{walletId}/transactions/estimate'),
  route('POST', `/wallets/${uuidPattern}/transactions/broadcast`, `/wallets/${sampleUuid}/transactions/broadcast`, '/wallets/{walletId}/transactions/broadcast'),
  route('POST', `/wallets/${uuidPattern}/psbt/create`, `/wallets/${sampleUuid}/psbt/create`, '/wallets/{walletId}/psbt/create'),
  route('POST', `/wallets/${uuidPattern}/psbt/broadcast`, `/wallets/${sampleUuid}/psbt/broadcast`, '/wallets/{walletId}/psbt/broadcast'),

  // Hardware wallet device management
  route('GET', '/devices', '/devices', '/devices'),
  route('POST', '/devices', '/devices', '/devices'),
  route('PATCH', `/devices/${uuidPattern}`, `/devices/${sampleUuid}`, '/devices/{deviceId}'),
  route('DELETE', `/devices/${uuidPattern}`, `/devices/${sampleUuid}`, '/devices/{deviceId}'),

  // Draft transactions (multisig)
  route('GET', `/wallets/${uuidPattern}/drafts`, `/wallets/${sampleUuid}/drafts`, '/wallets/{walletId}/drafts'),
  route('GET', `/wallets/${uuidPattern}/drafts/${uuidPattern}`, `/wallets/${sampleUuid}/drafts/${sampleUuid}`, '/wallets/{walletId}/drafts/{draftId}'),
  route('PATCH', `/wallets/${uuidPattern}/drafts/${uuidPattern}`, `/wallets/${sampleUuid}/drafts/${sampleUuid}`, '/wallets/{walletId}/drafts/{draftId}'),

  // Mobile permissions
  route('GET', '/mobile-permissions', '/mobile-permissions', '/mobile-permissions'),
  route('GET', `/wallets/${uuidPattern}/mobile-permissions`, `/wallets/${sampleUuid}/mobile-permissions`, '/wallets/{walletId}/mobile-permissions'),
  route('PATCH', `/wallets/${uuidPattern}/mobile-permissions`, `/wallets/${sampleUuid}/mobile-permissions`, '/wallets/{walletId}/mobile-permissions'),
  route('PATCH', `/wallets/${uuidPattern}/mobile-permissions/${uuidPattern}`, `/wallets/${sampleUuid}/mobile-permissions/${sampleUuid}`, '/wallets/{walletId}/mobile-permissions/{userId}'),
  route('DELETE', `/wallets/${uuidPattern}/mobile-permissions/${uuidPattern}/caps`, `/wallets/${sampleUuid}/mobile-permissions/${sampleUuid}/caps`, '/wallets/{walletId}/mobile-permissions/{userId}/caps'),
  route('DELETE', `/wallets/${uuidPattern}/mobile-permissions`, `/wallets/${sampleUuid}/mobile-permissions`, '/wallets/{walletId}/mobile-permissions'),
];

export const ALLOWED_ROUTES: Array<{ method: string; pattern: RegExp }> = GATEWAY_ROUTE_CONTRACTS.map(
  ({ method, pattern }) => ({ method, pattern })
);

/**
 * Check if a request matches the whitelist
 * Exported for testing
 */
export function isAllowedRoute(method: string, path: string): boolean {
  return ALLOWED_ROUTES.some(
    (route) => route.method === method && route.pattern.test(path)
  );
}

/**
 * Middleware to check if route is whitelisted
 *
 * SECURITY: Blocked routes are logged as security events.
 * Repeated attempts to access non-whitelisted routes may indicate
 * reconnaissance or an attempt to find vulnerabilities.
 *
 * Exported for testing
 */
export function checkWhitelist(req: Request, res: Response, next: () => void): void {
  const { method } = req;
  // Use baseUrl + path to get full path regardless of router mounting
  // When mounted at /api/v1, req.path is stripped but baseUrl preserves it
  const fullPath = req.baseUrl + req.path;
  const authReq = req as AuthenticatedRequest;

  if (!isAllowedRoute(method, fullPath)) {
    logSecurityEvent('ROUTE_BLOCKED', {
      method,
      path: fullPath,
      ip: req.ip,
      userId: authReq.user?.userId,
      userAgent: req.headers['user-agent'],
      // Could indicate probing for vulnerabilities
      severity: 'low',
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'This endpoint is not available via the mobile API',
    });
    return;
  }

  next();
}
