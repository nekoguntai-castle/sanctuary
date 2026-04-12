/**
 * Mobile Permission Middleware
 *
 * Enforces mobile permissions before proxying sensitive requests to the backend.
 * This middleware checks with the backend's internal API to verify that the
 * authenticated user has permission to perform the requested action via mobile.
 *
 * ## How It Works
 *
 * 1. Extract walletId from request params (supports both :id and :walletId)
 * 2. Extract userId from authenticated request
 * 3. Call backend's internal permission check endpoint
 * 4. Return 403 if denied, otherwise continue to proxy
 *
 * ## Usage
 *
 * ```typescript
 * router.post('/wallets/:id/transactions/create',
 *   authenticate,
 *   requireMobilePermission('createTransaction'),
 *   proxy
 * );
 * ```
 *
 * ## Security
 *
 * Internal requests to backend are authenticated via HMAC signature.
 * The gateway secret must be configured and match the backend.
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { AuthenticatedRequest } from './auth';
import { createLogger } from '../utils/logger';
import { logSecurityEvent } from './requestLogger';
import { generateGatewaySignature } from '../../../shared/utils/gatewayAuth';
import type { MobileAction } from '../../../shared/schemas/mobileApiRequests';

const log = createLogger('MOBILE-PERM');

/**
 * Response from backend permission check
 */
interface PermissionCheckResponse {
  allowed: boolean;
  reason?: string;
}

/**
 * Check mobile permission with backend
 */
async function checkPermissionWithBackend(
  walletId: string,
  userId: string,
  action: MobileAction
): Promise<PermissionCheckResponse> {
  const path = '/internal/mobile-permissions/check';
  const body = { walletId, userId, action };
  const { signature, timestamp } = generateGatewaySignature('POST', path, body, config.gatewaySecret);
  const payload = JSON.stringify(body);

  try {
    const response = await fetch(
      `${config.backendUrl}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Signature': signature,
          'X-Gateway-Timestamp': timestamp,
        },
        body: payload,
      }
    );

    if (!response.ok) {
      log.error('Backend permission check failed', {
        status: response.status,
        walletId,
        userId,
        action,
      });
      // Fail closed - deny on error
      return { allowed: false, reason: 'Permission check failed' };
    }

    const result = await response.json() as PermissionCheckResponse;
    return result;
  } catch (error) {
    log.error('Error calling backend permission check', {
      error: error instanceof Error ? error.message : String(error),
      walletId,
      userId,
      action,
    });
    // Fail closed - deny on error
    return { allowed: false, reason: 'Permission check unavailable' };
  }
}

/**
 * Middleware factory to require a specific mobile permission
 *
 * SECURITY: This middleware fails closed - if the permission check fails
 * for any reason (network error, backend down, etc.), access is denied.
 *
 * @param action - The mobile action to check permission for
 * @returns Express middleware function
 */
export function requireMobilePermission(action: MobileAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    // Extract walletId from params (supports both :id and :walletId patterns)
    const walletId = (req.params.id || req.params.walletId) as string;
    const userId = authReq.user?.userId;

    // Must be authenticated
    if (!userId) {
      log.warn('Mobile permission check without auth', { action, path: req.path });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    // Must have walletId for wallet-scoped permissions
    if (!walletId) {
      log.warn('Mobile permission check without walletId', { action, path: req.path, userId });
      res.status(400).json({
        error: 'Bad Request',
        message: 'Wallet ID required for this operation',
      });
      return;
    }

    // Check permission with backend
    const result = await checkPermissionWithBackend(walletId, userId, action);

    if (!result.allowed) {
      logSecurityEvent('MOBILE_PERMISSION_DENIED', {
        action,
        walletId,
        userId,
        reason: result.reason,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        severity: 'medium',
      });

      log.info('Mobile permission denied', {
        action,
        walletId,
        userId,
        reason: result.reason,
      });

      res.status(403).json({
        error: 'Forbidden',
        message: result.reason || `Mobile access denied for action: ${action}`,
      });
      return;
    }

    log.debug('Mobile permission granted', { action, walletId, userId });
    next();
  };
}

/**
 * Mapping of route patterns to required mobile actions
 * Used to automatically apply permission checks to routes.
 *
 * Note: Only routes with walletId in the path can use the mobile permission
 * middleware. User-scoped routes like /api/v1/devices rely on backend access
 * control because they are not wallet-scoped.
 */
export const ROUTE_ACTION_MAP: Record<string, MobileAction> = {
  // Transaction operations
  'POST:/wallets/:id/transactions/create': 'createTransaction',
  'POST:/wallets/:id/transactions/estimate': 'createTransaction',
  'POST:/wallets/:id/transactions/broadcast': 'broadcast',
  'POST:/wallets/:id/psbt/create': 'createTransaction',
  'POST:/wallets/:id/psbt/broadcast': 'broadcast',

  // Address generation
  'POST:/wallets/:id/addresses/generate': 'generateAddress',

  // Labels
  'POST:/wallets/:id/labels': 'manageLabels',
  'PUT:/wallets/:id/labels/:labelId': 'manageLabels',
  'DELETE:/wallets/:id/labels/:labelId': 'manageLabels',

  // Drafts (PSBT signing)
  'PATCH:/wallets/:id/drafts/:draftId': 'signPsbt',
};
