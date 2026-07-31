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
import type { MobileAction } from '@sanctuary/shared/schemas/mobileApiRequests';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type GatewayAuthMode = 'public' | 'authenticated';
export type GatewayRateLimiterClass =
  | 'none'
  | 'default'
  | 'transactionCreate'
  | 'broadcast'
  | 'deviceRegistration'
  | 'addressGeneration';
export type GatewayValidationDecision =
  | { mode: 'schema' }
  | { mode: 'none'; reason: string };

export type GatewayRouteContract = {
  method: HttpMethod;
  pattern: RegExp;
  samplePath: string;
  openApiPath: string;
  expressPath: string;
  auth: GatewayAuthMode;
  rateLimiter: GatewayRateLimiterClass;
  validation: GatewayValidationDecision;
  mobilePermission?: MobileAction;
  accessControlReason?: string;
};

const uuidPattern = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const txidPattern = '[a-f0-9]{64}';
const sampleUuid = '12345678-1234-1234-1234-123456789abc';
const sampleTxid = 'a'.repeat(64);

function route(
  method: HttpMethod,
  pathPattern: string,
  samplePath: string,
  openApiPath: string,
  metadata: {
    expressPath: string;
    auth?: GatewayAuthMode;
    rateLimiter?: GatewayRateLimiterClass;
    validation: GatewayValidationDecision;
    mobilePermission?: MobileAction;
    accessControlReason?: string;
  }
): GatewayRouteContract {
  return {
    method,
    pattern: new RegExp(`^/api/v1${pathPattern}$`),
    samplePath: `/api/v1${samplePath}`,
    openApiPath,
    expressPath: metadata.expressPath,
    auth: metadata.auth ?? 'authenticated',
    rateLimiter: metadata.rateLimiter ?? 'default',
    validation: metadata.validation,
    mobilePermission: metadata.mobilePermission,
    accessControlReason: metadata.accessControlReason,
  };
}

const schemaValidation: GatewayValidationDecision = { mode: 'schema' };
const noBody = (reason: string): GatewayValidationDecision => ({ mode: 'none', reason });
const backendAccess = 'Backend route enforces authenticated user access for this non-wallet-scoped or administrative mobile operation.';
const noRequestBody = 'Route does not accept a request body.';
const readOnlyNoBody = 'Read-only route does not accept a request body.';

function shouldRegisterExplicitProxyRoute(routeContract: GatewayRouteContract): boolean {
  // The catch-all authenticated proxy handles ordinary default-limited routes.
  // Routes with public auth, a non-default limiter, or wallet mobile-permission
  // enforcement need their middleware chain registered before that catch-all.
  return routeContract.auth === 'public' ||
    routeContract.rateLimiter !== 'default' ||
    routeContract.mobilePermission !== undefined;
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
  route('POST', '/auth/login', '/auth/login', '/auth/login', {
    expressPath: '/api/v1/auth/login',
    auth: 'public',
    rateLimiter: 'none',
    validation: schemaValidation,
  }),
  route('POST', '/auth/refresh', '/auth/refresh', '/auth/refresh', {
    expressPath: '/api/v1/auth/refresh',
    auth: 'public',
    rateLimiter: 'none',
    validation: schemaValidation,
  }),
  route('POST', '/auth/logout', '/auth/logout', '/auth/logout', {
    expressPath: '/api/v1/auth/logout',
    validation: schemaValidation,
    accessControlReason: backendAccess,
  }),
  route('POST', '/auth/logout-all', '/auth/logout-all', '/auth/logout-all', {
    expressPath: '/api/v1/auth/logout-all',
    validation: noBody(noRequestBody),
    accessControlReason: backendAccess,
  }),
  route('POST', '/auth/2fa/verify', '/auth/2fa/verify', '/auth/2fa/verify', {
    expressPath: '/api/v1/auth/2fa/verify',
    auth: 'public',
    rateLimiter: 'none',
    validation: schemaValidation,
  }),
  route('GET', '/auth/me', '/auth/me', '/auth/me', {
    expressPath: '/api/v1/auth/me',
    validation: noBody(readOnlyNoBody),
  }),
  route('PATCH', '/auth/me/preferences', '/auth/me/preferences', '/auth/me/preferences', {
    expressPath: '/api/v1/auth/me/preferences',
    validation: schemaValidation,
    accessControlReason: backendAccess,
  }),

  // Session management
  route('GET', '/auth/sessions', '/auth/sessions', '/auth/sessions', {
    expressPath: '/api/v1/auth/sessions',
    validation: noBody(readOnlyNoBody),
  }),
  route('DELETE', `/auth/sessions/${uuidPattern}`, `/auth/sessions/${sampleUuid}`, '/auth/sessions/{id}', {
    expressPath: '/api/v1/auth/sessions/:id',
    validation: noBody(noRequestBody),
    accessControlReason: backendAccess,
  }),

  // Wallets (read-only + sync)
  route('GET', '/wallets', '/wallets', '/wallets', {
    expressPath: '/api/v1/wallets',
    validation: noBody(readOnlyNoBody),
  }),
  route('GET', `/wallets/${uuidPattern}`, `/wallets/${sampleUuid}`, '/wallets/{walletId}', {
    expressPath: '/api/v1/wallets/:id',
    validation: noBody(readOnlyNoBody),
  }),
  route('POST', `/sync/wallet/${uuidPattern}`, `/sync/wallet/${sampleUuid}`, '/sync/wallet/{walletId}', {
    expressPath: '/api/v1/sync/wallet/:id',
    validation: noBody(noRequestBody),
    accessControlReason: 'Backend sync route enforces authenticated wallet access.',
  }),

  // Transactions (read-only)
  route('GET', `/wallets/${uuidPattern}/transactions`, `/wallets/${sampleUuid}/transactions`, '/wallets/{walletId}/transactions', {
    expressPath: '/api/v1/wallets/:id/transactions',
    validation: noBody(readOnlyNoBody),
  }),
  // Canonical detail lookup requires both wallet and txid; the backend enforces wallet view access.
  route('GET', `/wallets/${uuidPattern}/transactions/${txidPattern}`, `/wallets/${sampleUuid}/transactions/${sampleTxid}`, '/wallets/{walletId}/transactions/{txid}', {
    expressPath: '/api/v1/wallets/:walletId/transactions/:txid',
    validation: noBody(readOnlyNoBody),
  }),
  // Retained during the backend deprecation window; ambiguous txids fail with 409.
  route('GET', `/transactions/${txidPattern}`, `/transactions/${sampleTxid}`, '/transactions/{txid}', {
    expressPath: '/api/v1/transactions/:txid',
    validation: noBody(readOnlyNoBody),
  }),

  // Addresses (read-only + generate)
  route('GET', `/wallets/${uuidPattern}/addresses/summary`, `/wallets/${sampleUuid}/addresses/summary`, '/wallets/{walletId}/addresses/summary', {
    expressPath: '/api/v1/wallets/:id/addresses/summary',
    validation: noBody(readOnlyNoBody),
  }),
  route('GET', `/wallets/${uuidPattern}/addresses`, `/wallets/${sampleUuid}/addresses`, '/wallets/{walletId}/addresses', {
    expressPath: '/api/v1/wallets/:id/addresses',
    validation: noBody(readOnlyNoBody),
  }),
  route('POST', `/wallets/${uuidPattern}/addresses/generate`, `/wallets/${sampleUuid}/addresses/generate`, '/wallets/{walletId}/addresses/generate', {
    expressPath: '/api/v1/wallets/:id/addresses/generate',
    rateLimiter: 'addressGeneration',
    validation: noBody(noRequestBody),
    mobilePermission: 'generateAddress',
  }),

  // UTXOs (read-only)
  route('GET', `/wallets/${uuidPattern}/utxos`, `/wallets/${sampleUuid}/utxos`, '/wallets/{walletId}/utxos', {
    expressPath: '/api/v1/wallets/:id/utxos',
    validation: noBody(readOnlyNoBody),
  }),

  // Labels (read + write)
  route('GET', `/wallets/${uuidPattern}/labels`, `/wallets/${sampleUuid}/labels`, '/wallets/{walletId}/labels', {
    expressPath: '/api/v1/wallets/:id/labels',
    validation: noBody(readOnlyNoBody),
  }),
  route('POST', `/wallets/${uuidPattern}/labels`, `/wallets/${sampleUuid}/labels`, '/wallets/{walletId}/labels', {
    expressPath: '/api/v1/wallets/:id/labels',
    validation: schemaValidation,
    mobilePermission: 'manageLabels',
  }),
  route('PUT', `/wallets/${uuidPattern}/labels/${uuidPattern}`, `/wallets/${sampleUuid}/labels/${sampleUuid}`, '/wallets/{walletId}/labels/{labelId}', {
    expressPath: '/api/v1/wallets/:id/labels/:labelId',
    validation: schemaValidation,
    mobilePermission: 'manageLabels',
  }),
  route('DELETE', `/wallets/${uuidPattern}/labels/${uuidPattern}`, `/wallets/${sampleUuid}/labels/${sampleUuid}`, '/wallets/{walletId}/labels/{labelId}', {
    expressPath: '/api/v1/wallets/:id/labels/:labelId',
    validation: noBody(noRequestBody),
    mobilePermission: 'manageLabels',
  }),

  // Bitcoin status
  route('GET', '/bitcoin/status', '/bitcoin/status', '/bitcoin/status', {
    expressPath: '/api/v1/bitcoin/status',
    validation: noBody(readOnlyNoBody),
  }),
  route('GET', '/bitcoin/fees', '/bitcoin/fees', '/bitcoin/fees', {
    expressPath: '/api/v1/bitcoin/fees',
    validation: noBody(readOnlyNoBody),
  }),

  // Price
  route('GET', '/price', '/price', '/price', {
    expressPath: '/api/v1/price',
    validation: noBody(readOnlyNoBody),
  }),

  // Pending transactions
  route('GET', '/transactions/pending', '/transactions/pending', '/transactions/pending', {
    expressPath: '/api/v1/transactions/pending',
    validation: noBody(readOnlyNoBody),
  }),

  // Push notifications (device registration)
  route('POST', '/push/register', '/push/register', '/push/register', {
    expressPath: '/api/v1/push/register',
    rateLimiter: 'deviceRegistration',
    validation: schemaValidation,
    accessControlReason: backendAccess,
  }),
  route('DELETE', '/push/unregister', '/push/unregister', '/push/unregister', {
    expressPath: '/api/v1/push/unregister',
    validation: schemaValidation,
    accessControlReason: backendAccess,
  }),
  route('GET', '/push/devices', '/push/devices', '/push/devices', {
    expressPath: '/api/v1/push/devices',
    validation: noBody(readOnlyNoBody),
  }),
  route('DELETE', `/push/devices/${uuidPattern}`, `/push/devices/${sampleUuid}`, '/push/devices/{id}', {
    expressPath: '/api/v1/push/devices/:id',
    validation: noBody(noRequestBody),
    accessControlReason: backendAccess,
  }),

  // Transaction building & broadcasting
  route('POST', `/wallets/${uuidPattern}/transactions/create`, `/wallets/${sampleUuid}/transactions/create`, '/wallets/{walletId}/transactions/create', {
    expressPath: '/api/v1/wallets/:id/transactions/create',
    rateLimiter: 'transactionCreate',
    validation: schemaValidation,
    mobilePermission: 'createTransaction',
  }),
  route('POST', `/wallets/${uuidPattern}/transactions/estimate`, `/wallets/${sampleUuid}/transactions/estimate`, '/wallets/{walletId}/transactions/estimate', {
    expressPath: '/api/v1/wallets/:id/transactions/estimate',
    rateLimiter: 'transactionCreate',
    validation: schemaValidation,
    mobilePermission: 'createTransaction',
  }),
  route('POST', `/wallets/${uuidPattern}/transactions/broadcast`, `/wallets/${sampleUuid}/transactions/broadcast`, '/wallets/{walletId}/transactions/broadcast', {
    expressPath: '/api/v1/wallets/:id/transactions/broadcast',
    rateLimiter: 'broadcast',
    validation: schemaValidation,
    mobilePermission: 'broadcast',
  }),
  route('POST', `/wallets/${uuidPattern}/psbt/create`, `/wallets/${sampleUuid}/psbt/create`, '/wallets/{walletId}/psbt/create', {
    expressPath: '/api/v1/wallets/:id/psbt/create',
    rateLimiter: 'transactionCreate',
    validation: schemaValidation,
    mobilePermission: 'createTransaction',
  }),
  route('POST', `/wallets/${uuidPattern}/psbt/broadcast`, `/wallets/${sampleUuid}/psbt/broadcast`, '/wallets/{walletId}/psbt/broadcast', {
    expressPath: '/api/v1/wallets/:id/psbt/broadcast',
    rateLimiter: 'broadcast',
    validation: schemaValidation,
    mobilePermission: 'broadcast',
  }),

  // Hardware wallet device management
  route('GET', '/devices', '/devices', '/devices', {
    expressPath: '/api/v1/devices',
    validation: noBody(readOnlyNoBody),
  }),
  route('POST', '/devices', '/devices', '/devices', {
    expressPath: '/api/v1/devices',
    validation: schemaValidation,
    accessControlReason: backendAccess,
  }),
  route('PATCH', `/devices/${uuidPattern}`, `/devices/${sampleUuid}`, '/devices/{deviceId}', {
    expressPath: '/api/v1/devices/:deviceId',
    validation: schemaValidation,
    accessControlReason: backendAccess,
  }),
  route('DELETE', `/devices/${uuidPattern}`, `/devices/${sampleUuid}`, '/devices/{deviceId}', {
    expressPath: '/api/v1/devices/:deviceId',
    validation: noBody(noRequestBody),
    accessControlReason: backendAccess,
  }),

  // Draft transactions (multisig)
  route('GET', `/wallets/${uuidPattern}/drafts`, `/wallets/${sampleUuid}/drafts`, '/wallets/{walletId}/drafts', {
    expressPath: '/api/v1/wallets/:id/drafts',
    validation: noBody(readOnlyNoBody),
  }),
  route('GET', `/wallets/${uuidPattern}/drafts/${uuidPattern}`, `/wallets/${sampleUuid}/drafts/${sampleUuid}`, '/wallets/{walletId}/drafts/{draftId}', {
    expressPath: '/api/v1/wallets/:id/drafts/:draftId',
    validation: noBody(readOnlyNoBody),
  }),
  route('PATCH', `/wallets/${uuidPattern}/drafts/${uuidPattern}`, `/wallets/${sampleUuid}/drafts/${sampleUuid}`, '/wallets/{walletId}/drafts/{draftId}', {
    expressPath: '/api/v1/wallets/:id/drafts/:draftId',
    validation: schemaValidation,
    mobilePermission: 'signPsbt',
  }),

  // Mobile permissions
  route('GET', '/mobile-permissions', '/mobile-permissions', '/mobile-permissions', {
    expressPath: '/api/v1/mobile-permissions',
    validation: noBody(readOnlyNoBody),
  }),
  route('GET', `/wallets/${uuidPattern}/mobile-permissions`, `/wallets/${sampleUuid}/mobile-permissions`, '/wallets/{walletId}/mobile-permissions', {
    expressPath: '/api/v1/wallets/:id/mobile-permissions',
    validation: noBody(readOnlyNoBody),
  }),
  route('PATCH', `/wallets/${uuidPattern}/mobile-permissions`, `/wallets/${sampleUuid}/mobile-permissions`, '/wallets/{walletId}/mobile-permissions', {
    expressPath: '/api/v1/wallets/:id/mobile-permissions',
    validation: schemaValidation,
    accessControlReason: 'Backend mobile-permissions route enforces wallet ownership/admin access.',
  }),
  route('PATCH', `/wallets/${uuidPattern}/mobile-permissions/${uuidPattern}`, `/wallets/${sampleUuid}/mobile-permissions/${sampleUuid}`, '/wallets/{walletId}/mobile-permissions/{userId}', {
    expressPath: '/api/v1/wallets/:id/mobile-permissions/:userId',
    validation: schemaValidation,
    accessControlReason: 'Backend mobile-permissions route enforces wallet ownership/admin access.',
  }),
  route('DELETE', `/wallets/${uuidPattern}/mobile-permissions/${uuidPattern}/caps`, `/wallets/${sampleUuid}/mobile-permissions/${sampleUuid}/caps`, '/wallets/{walletId}/mobile-permissions/{userId}/caps', {
    expressPath: '/api/v1/wallets/:id/mobile-permissions/:userId/caps',
    validation: noBody(noRequestBody),
    accessControlReason: 'Backend mobile-permissions route enforces wallet ownership/admin access.',
  }),
  route('DELETE', `/wallets/${uuidPattern}/mobile-permissions`, `/wallets/${sampleUuid}/mobile-permissions`, '/wallets/{walletId}/mobile-permissions', {
    expressPath: '/api/v1/wallets/:id/mobile-permissions',
    validation: noBody(noRequestBody),
    accessControlReason: 'Backend mobile-permissions route enforces wallet ownership/admin access.',
  }),
];

/**
 * Subset consumed by `routes/proxy/index.ts` for routes whose middleware chain
 * differs from the authenticated default catch-all.
 */
export const EXPLICIT_PROXY_ROUTE_CONTRACTS = GATEWAY_ROUTE_CONTRACTS.filter(shouldRegisterExplicitProxyRoute);

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
