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
import { checkWhitelist, EXPLICIT_PROXY_ROUTE_CONTRACTS } from './whitelist';
import { proxy } from './proxyConfig';
import type { RequestHandler, Router as RouterType } from 'express';
import type { GatewayRateLimiterClass, GatewayRouteContract } from './whitelist';

export {
  ALLOWED_ROUTES,
  EXPLICIT_PROXY_ROUTE_CONTRACTS,
  GATEWAY_ROUTE_CONTRACTS,
  isAllowedRoute,
  checkWhitelist,
} from './whitelist';

const router = Router();

const rateLimiters: Record<Exclude<GatewayRateLimiterClass, 'none'>, RequestHandler> = {
  default: defaultRateLimiter,
  transactionCreate: transactionCreateRateLimiter,
  broadcast: broadcastRateLimiter,
  deviceRegistration: deviceRegistrationRateLimiter,
  addressGeneration: addressGenerationRateLimiter,
};

const routeMethods = {
  GET: router.get.bind(router),
  POST: router.post.bind(router),
  PUT: router.put.bind(router),
  PATCH: router.patch.bind(router),
  DELETE: router.delete.bind(router),
} satisfies Record<GatewayRouteContract['method'], RouterType['get']>;

function getProxyMiddlewares(route: GatewayRouteContract): RequestHandler[] {
  const middlewares: RequestHandler[] = [];

  if (route.auth === 'authenticated') {
    middlewares.push(authenticate);
  }

  if (route.rateLimiter !== 'none') {
    middlewares.push(rateLimiters[route.rateLimiter]);
  }

  middlewares.push(checkWhitelist);

  if (route.mobilePermission) {
    middlewares.push(requireMobilePermission(route.mobilePermission));
  }

  middlewares.push(validateRequest, proxy);
  return middlewares;
}

for (const routeContract of EXPLICIT_PROXY_ROUTE_CONTRACTS) {
  routeMethods[routeContract.method](routeContract.expressPath, ...getProxyMiddlewares(routeContract));
}

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
