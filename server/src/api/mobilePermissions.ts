/**
 * Mobile Permissions API Routes
 *
 * Manages mobile access restrictions for wallets.
 * Mobile permissions act as ADDITIONAL restrictions on top of wallet roles.
 *
 * ## Design Principles
 *
 * 1. **Additional restrictions model** - Mobile permissions LIMIT what users can do
 *    via mobile, even if their wallet role allows more
 * 2. **Per-wallet granularity** - Each wallet can have different permissions
 * 3. **Self + owner override** - Users can restrict themselves, owners can set caps
 * 4. **Capability flags** - Granular boolean flags for each action
 *
 * ## Endpoints
 *
 * User endpoints (authenticated):
 * - GET /api/v1/mobile-permissions - Get all user's mobile permissions
 * - GET /api/v1/wallets/:id/mobile-permissions - Get wallet permissions
 * - PATCH /api/v1/wallets/:id/mobile-permissions - Update own permissions
 * - PATCH /api/v1/wallets/:id/mobile-permissions/:userId - Set user's max (owner only)
 *
 * Internal endpoint (gateway):
 * - POST /internal/mobile-permissions/check - Check permission for gateway
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { verifyGatewayRequest } from '../middleware/gatewayAuth';
import { validate } from '../middleware/validate';
import { createLogger } from '../utils/logger';
import { mobilePermissionService, type MobileAction, ALL_MOBILE_ACTIONS } from '../services/mobilePermissions';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes, InvalidInputError } from '../errors/ApiError';
import {
  MobilePermissionUpdateRequestSchema,
  type MobilePermissionUpdateRequest,
} from '../../../shared/schemas/mobileApiRequests';

const publicRouter = Router();
const internalRouter = Router();
const log = createLogger('MOBILE_PERMS:ROUTE');

/**
 * Validate mobile action
 */
function isValidMobileAction(action: string): action is MobileAction {
  return ALL_MOBILE_ACTIONS.includes(action as MobileAction);
}

const GatewayPermissionCheckBodySchema = z.object({
  walletId: z.string().min(1),
  userId: z.string().min(1),
  action: z.string().min(1),
}).superRefine((data, ctx) => {
  if (!isValidMobileAction(data.action)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid action: ${data.action}`,
      path: ['action'],
    });
  }
});

const gatewayPermissionCheckValidationMessage = (issues: Array<{ message: string }>) => {
  const invalidActionIssue = issues.find(issue => issue.message.startsWith('Invalid action:'));
  return invalidActionIssue?.message ?? 'walletId, userId, and action are required';
};

/**
 * Validate permission update input
 */
function formatPermissionValidationError(error: z.ZodError): string {
  const issue = error.issues[0];

  if (!issue) {
    return 'Invalid mobile permission update';
  }

  if (issue.code === 'unrecognized_keys') {
    return `Invalid permission key: ${issue.keys[0]}`;
  }

  const [field] = issue.path;
  if (field) {
    return `Permission value for ${String(field)} must be a boolean`;
  }

  return issue.message;
}

function validatePermissionInput(body: unknown): { valid: boolean; value?: MobilePermissionUpdateRequest; error?: string } {
  const result = MobilePermissionUpdateRequestSchema.safeParse(body);

  if (!result.success) {
    return { valid: false, error: formatPermissionValidationError(result.error) };
  }

  return { valid: true, value: result.data };
}

// =============================================================================
// User Endpoints
// =============================================================================

/**
 * GET /api/v1/mobile-permissions
 * Get all mobile permissions for the authenticated user
 */
publicRouter.get('/mobile-permissions', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;

  const permissions = await mobilePermissionService.getUserMobilePermissions(userId);

  res.json({
    permissions: permissions.map((p) => ({
      id: p.id,
      walletId: p.walletId,
      walletName: p.wallet.name,
      walletNetwork: p.wallet.network,
      role: p.role,
      effectivePermissions: p.effectivePermissions,
      hasCustomRestrictions: p.canViewBalance !== true ||
        p.canViewTransactions !== true ||
        p.canViewUtxos !== true ||
        p.canCreateTransaction !== true ||
        p.canBroadcast !== true ||
        p.canSignPsbt !== true ||
        p.canGenerateAddress !== true ||
        p.canManageLabels !== true ||
        p.canManageDevices !== true ||
        p.canShareWallet !== true ||
        p.canDeleteWallet !== true,
      hasOwnerRestrictions: p.ownerMaxPermissions !== null,
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}));

// =============================================================================
// Wallet-Scoped Endpoints
// =============================================================================

/**
 * GET /api/v1/wallets/:id/mobile-permissions
 * Get mobile permissions for a wallet
 */
publicRouter.get('/wallets/:id/mobile-permissions', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id: walletId } = req.params;

  // Get effective permissions for the requesting user
  const effective = await mobilePermissionService.getEffectivePermissions(walletId, userId);

  // If user is owner, also get all wallet permissions
  let allWalletPermissions = null;
  if (effective.role === 'owner') {
    allWalletPermissions = await mobilePermissionService.getWalletPermissions(walletId, userId);
  }

  res.json({
    walletId,
    userId,
    role: effective.role,
    permissions: effective.permissions,
    hasCustomRestrictions: effective.hasCustomRestrictions,
    hasOwnerRestrictions: effective.hasOwnerRestrictions,
    ...(allWalletPermissions && { walletUsers: allWalletPermissions }),
  });
}));

/**
 * PATCH /api/v1/wallets/:id/mobile-permissions
 * Update own mobile permissions for a wallet
 */
publicRouter.patch('/wallets/:id/mobile-permissions', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id: walletId } = req.params;

  // Validate input
  const validation = validatePermissionInput(req.body);
  if (!validation.valid) {
    throw new InvalidInputError(validation.error!);
  }
  const permissionUpdate = validation.value!;

  const result = await mobilePermissionService.updateOwnPermissions(
    walletId,
    userId,
    permissionUpdate,
    userId
  );

  log.info('Updated mobile permissions', {
    walletId,
    userId,
    changes: Object.keys(permissionUpdate),
  });

  res.json({
    success: true,
    walletId,
    userId,
    role: result.role,
    permissions: result.permissions,
    hasCustomRestrictions: result.hasCustomRestrictions,
    hasOwnerRestrictions: result.hasOwnerRestrictions,
  });
}));

/**
 * PATCH /api/v1/wallets/:id/mobile-permissions/:userId
 * Set max permissions for a user (owner only)
 */
publicRouter.patch('/wallets/:id/mobile-permissions/:userId', authenticate, asyncHandler(async (req, res) => {
  const ownerId = req.user!.userId;
  const { id: walletId, userId: targetUserId } = req.params;

  // Validate input
  const validation = validatePermissionInput(req.body);
  if (!validation.valid) {
    throw new InvalidInputError(validation.error!);
  }
  const permissionUpdate = validation.value!;

  const result = await mobilePermissionService.setMaxPermissions(
    walletId,
    targetUserId,
    ownerId,
    permissionUpdate
  );

  log.info('Set mobile permission caps', {
    walletId,
    targetUserId,
    ownerId,
    caps: Object.keys(permissionUpdate),
  });

  res.json({
    success: true,
    walletId,
    userId: targetUserId,
    role: result.role,
    permissions: result.permissions,
    hasCustomRestrictions: result.hasCustomRestrictions,
    hasOwnerRestrictions: result.hasOwnerRestrictions,
  });
}));

/**
 * DELETE /api/v1/wallets/:id/mobile-permissions/:userId/caps
 * Clear max permissions for a user (owner only)
 */
publicRouter.delete('/wallets/:id/mobile-permissions/:userId/caps', authenticate, asyncHandler(async (req, res) => {
  const ownerId = req.user!.userId;
  const { id: walletId, userId: targetUserId } = req.params;

  const result = await mobilePermissionService.clearMaxPermissions(
    walletId,
    targetUserId,
    ownerId
  );

  log.info('Cleared mobile permission caps', {
    walletId,
    targetUserId,
    ownerId,
  });

  res.json({
    success: true,
    walletId,
    userId: targetUserId,
    role: result.role,
    permissions: result.permissions,
    hasCustomRestrictions: result.hasCustomRestrictions,
    hasOwnerRestrictions: result.hasOwnerRestrictions,
  });
}));

/**
 * DELETE /api/v1/wallets/:id/mobile-permissions
 * Reset own mobile permissions to defaults
 */
publicRouter.delete('/wallets/:id/mobile-permissions', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { id: walletId } = req.params;

  await mobilePermissionService.resetPermissions(walletId, userId);

  log.info('Reset mobile permissions', { walletId, userId });

  res.json({
    success: true,
    message: 'Mobile permissions reset to defaults',
  });
}));

// =============================================================================
// Internal Endpoint (Gateway)
// =============================================================================

/**
 * POST /internal/mobile-permissions/check
 *
 * INTERNAL ENDPOINT - Called by gateway to check mobile permissions.
 * Returns whether a user can perform an action on a wallet from mobile.
 *
 * Security: Requires HMAC-signed gateway authentication
 *
 * Request body:
 *   - walletId: string
 *   - userId: string
 *   - action: MobileAction
 */
internalRouter.post('/mobile-permissions/check', verifyGatewayRequest, validate(
  { body: GatewayPermissionCheckBodySchema },
  { message: gatewayPermissionCheckValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { walletId, userId, action } = req.body;

  const result = await mobilePermissionService.checkForGateway(walletId, userId, action);

  res.json(result);
}));

export const mobilePermissionsInternalRoutes = internalRouter;
export default publicRouter;
