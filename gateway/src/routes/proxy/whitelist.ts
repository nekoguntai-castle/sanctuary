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
 * 1. Add pattern to ALLOWED_ROUTES array below
 * 2. Use regex to match dynamic segments (e.g., `[a-f0-9-]+` for UUIDs)
 * 3. Consider security implications before adding
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

/**
 * Whitelist of allowed API routes
 *
 * Format: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: RegExp }
 *
 * SECURITY: Only add routes that are safe for mobile app access.
 * Admin routes and sensitive operations should NOT be exposed.
 */
export const ALLOWED_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  // Authentication
  { method: 'POST', pattern: /^\/api\/v1\/auth\/login$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/refresh$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/logout$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/logout-all$/ },
  { method: 'POST', pattern: /^\/api\/v1\/auth\/2fa\/verify$/ },
  { method: 'GET', pattern: /^\/api\/v1\/auth\/me$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/auth\/me\/preferences$/ },

  // Session management
  { method: 'GET', pattern: /^\/api\/v1\/auth\/sessions$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/auth\/sessions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Wallets (read-only + sync)
  { method: 'GET', pattern: /^\/api\/v1\/wallets$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/sync$/ },

  // Transactions (read-only)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Addresses (read-only + generate)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/addresses\/summary$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/addresses$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/addresses\/generate$/ },

  // UTXOs (read-only)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/utxos$/ },

  // Labels (read + write)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/labels$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/labels$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/labels\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/labels\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Bitcoin status
  { method: 'GET', pattern: /^\/api\/v1\/bitcoin\/status$/ },
  { method: 'GET', pattern: /^\/api\/v1\/bitcoin\/fees$/ },

  // Price
  { method: 'GET', pattern: /^\/api\/v1\/price$/ },

  // Pending transactions
  { method: 'GET', pattern: /^\/api\/v1\/transactions\/pending$/ },

  // Push notifications (device registration)
  { method: 'POST', pattern: /^\/api\/v1\/push\/register$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/push\/unregister$/ },
  { method: 'GET', pattern: /^\/api\/v1\/push\/devices$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/push\/devices\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Transaction building & broadcasting
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions\/create$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions\/estimate$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/transactions\/broadcast$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/psbt\/create$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/psbt\/broadcast$/ },

  // Hardware wallet device management
  { method: 'GET', pattern: /^\/api\/v1\/devices$/ },
  { method: 'POST', pattern: /^\/api\/v1\/devices$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/devices\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/devices\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },

  // Draft transactions (multisig)
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/drafts$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/drafts\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/drafts\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/sign$/ },

  // Mobile permissions
  { method: 'GET', pattern: /^\/api\/v1\/mobile-permissions$/ },
  { method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions$/ },
  { method: 'PATCH', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/caps$/ },
  { method: 'DELETE', pattern: /^\/api\/v1\/wallets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/mobile-permissions$/ },
];

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
