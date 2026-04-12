/**
 * Proxy Routes
 *
 * This is the heart of the gateway's security model. Only routes explicitly
 * listed in ALLOWED_ROUTES are proxied to the backend. Everything else is blocked.
 *
 * ## How It Works
 *
 * 1. Request comes in from mobile app
 * 2. `checkWhitelist` middleware checks if route matches ALLOWED_ROUTES
 * 3. If not matched, return 403 Forbidden
 * 4. If matched, proxy to backend with extra headers
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import {
  defaultRateLimiter,
  transactionCreateRateLimiter,
  broadcastRateLimiter,
  deviceRegistrationRateLimiter,
  addressGenerationRateLimiter,
} from '../../middleware/rateLimit';
import { validateRequest } from '../../middleware/validateRequest';
import { requireMobilePermission } from '../../middleware/mobilePermission';
import { checkWhitelist } from './whitelist';
import { proxy } from './proxyConfig';

export { ALLOWED_ROUTES, GATEWAY_ROUTE_CONTRACTS, isAllowedRoute, checkWhitelist } from './whitelist';

const router = Router();

// Public routes (no auth required)
router.post('/api/v1/auth/login', checkWhitelist, validateRequest, proxy);
router.post('/api/v1/auth/refresh', checkWhitelist, validateRequest, proxy);
router.post('/api/v1/auth/2fa/verify', checkWhitelist, validateRequest, proxy);

// =============================================================================
// Protected routes with mobile permission checks
// =============================================================================

// Transaction operations
router.post(
  '/api/v1/wallets/:id/transactions/create',
  authenticate,
  transactionCreateRateLimiter,
  checkWhitelist,
  requireMobilePermission('createTransaction'),
  validateRequest,
  proxy
);

router.post(
  '/api/v1/wallets/:id/transactions/estimate',
  authenticate,
  transactionCreateRateLimiter,
  checkWhitelist,
  requireMobilePermission('createTransaction'),
  validateRequest,
  proxy
);

router.post(
  '/api/v1/wallets/:id/transactions/broadcast',
  authenticate,
  broadcastRateLimiter,
  checkWhitelist,
  requireMobilePermission('broadcast'),
  validateRequest,
  proxy
);

// PSBT operations
router.post(
  '/api/v1/wallets/:id/psbt/create',
  authenticate,
  transactionCreateRateLimiter,
  checkWhitelist,
  requireMobilePermission('createTransaction'),
  validateRequest,
  proxy
);

router.post(
  '/api/v1/wallets/:id/psbt/broadcast',
  authenticate,
  broadcastRateLimiter,
  checkWhitelist,
  requireMobilePermission('broadcast'),
  validateRequest,
  proxy
);

// Address generation
router.post(
  '/api/v1/wallets/:id/addresses/generate',
  authenticate,
  addressGenerationRateLimiter,
  checkWhitelist,
  requireMobilePermission('generateAddress'),
  validateRequest,
  proxy
);

// Label management (create - has walletId in path)
router.post(
  '/api/v1/wallets/:id/labels',
  authenticate,
  defaultRateLimiter,
  checkWhitelist,
  requireMobilePermission('manageLabels'),
  validateRequest,
  proxy
);

router.put(
  '/api/v1/wallets/:id/labels/:labelId',
  authenticate,
  defaultRateLimiter,
  checkWhitelist,
  requireMobilePermission('manageLabels'),
  validateRequest,
  proxy
);

router.delete(
  '/api/v1/wallets/:id/labels/:labelId',
  authenticate,
  defaultRateLimiter,
  checkWhitelist,
  requireMobilePermission('manageLabels'),
  validateRequest,
  proxy
);

// Note: Device management routes (/api/v1/devices) are user-scoped, not wallet-scoped,
// so they don't use mobile permission middleware. Access control is handled by the
// backend based on user authentication.

// Push notification device registration (strict rate limit)
router.post(
  '/api/v1/push/register',
  authenticate,
  deviceRegistrationRateLimiter,
  checkWhitelist,
  validateRequest,
  proxy
);

// Draft signing (multisig)
router.patch(
  '/api/v1/wallets/:id/drafts/:draftId',
  authenticate,
  defaultRateLimiter,
  checkWhitelist,
  requireMobilePermission('signPsbt'),
  validateRequest,
  proxy
);

// =============================================================================
// Protected routes (general - no special permission checks)
// =============================================================================

router.use(
  '/api/v1',
  authenticate,
  defaultRateLimiter,
  checkWhitelist,
  validateRequest,
  proxy
);

export default router;
