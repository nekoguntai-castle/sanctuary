/**
 * Wallet Policy API Routes
 *
 * CRUD endpoints for managing vault policies on individual wallets.
 * Policy management requires owner access.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import { vaultPolicyService, policyEvaluationEngine } from '../../services/vaultPolicy';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import type { CreatePolicyInput, UpdatePolicyInput } from '../../services/vaultPolicy/types';

const router = Router();

const MAX_PAGE_LIMIT = 200;

/** Pagination with clamping for policy events (max 200) */
const PolicyEventPaginationSchema = z.object({
  limit: z.coerce.number().int().catch(50).transform(v => Math.max(1, Math.min(v, MAX_PAGE_LIMIT))),
  offset: z.coerce.number().int().catch(0).transform(v => Math.max(0, v)),
});

const PolicyEvaluationBodySchema = z
  .object({
    recipient: z.unknown().optional(),
    amount: z.unknown().optional(),
    outputs: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.recipient || data.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'recipient and amount are required',
        path: ['recipient'],
      });
      return;
    }

    const validAmount = (
      (typeof data.amount === 'number' && Number.isInteger(data.amount) && data.amount >= 0) ||
      (typeof data.amount === 'string' && /^\d+$/.test(data.amount))
    );

    if (!validAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'amount must be a valid non-negative integer',
        path: ['amount'],
      });
    }
  });

const PolicyMutationBodySchema = z.object({
  name: z.unknown().optional(),
  description: z.unknown().optional(),
  type: z.unknown().optional(),
  config: z.unknown().optional(),
  priority: z.unknown().optional(),
  enforcement: z.unknown().optional(),
  enabled: z.unknown().optional(),
}).passthrough();

const PolicyAddressBodySchema = z
  .object({
    address: z.unknown().optional(),
    label: z.unknown().optional(),
    listType: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.address || !data.listType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'address and listType are required',
        path: ['address'],
      });
      return;
    }
    if (typeof data.address !== 'string' || data.address.length > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'address must be a string of 100 characters or fewer',
        path: ['address'],
      });
    }
    if (data.listType !== 'allow' && data.listType !== 'deny') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'listType must be "allow" or "deny"',
        path: ['listType'],
      });
    }
  });

const policyValidationMessage = (issues: Array<{ message: string }>) =>
  issues[0]?.message ?? 'Invalid policy request';

// ========================================
// POLICY EVENTS (must be before /:policyId to avoid "events" matching as policyId)
// ========================================

/**
 * GET /:walletId/policies/events - Get policy event log
 */
router.get('/:walletId/policies/events', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const { policyId, eventType, from, to, limit, offset } = req.query;

  const { limit: clampedLimit, offset: clampedOffset } = PolicyEventPaginationSchema.safeParse({ limit, offset }).data
    ?? { limit: 50, offset: 0 };

  const result = await vaultPolicyService.getWalletPolicyEvents(walletId, {
    policyId: policyId as string | undefined,
    eventType: eventType as string | undefined,
    from: from ? new Date(from as string) : undefined,
    to: to ? new Date(to as string) : undefined,
    limit: clampedLimit,
    offset: clampedOffset,
  });

  res.json(result);
}));

// ========================================
// POLICY EVALUATION PREVIEW
// ========================================

/**
 * POST /:walletId/policies/evaluate - Preview policy evaluation for a transaction
 * Returns which policies would trigger without creating anything.
 */
router.post('/:walletId/policies/evaluate', requireWalletAccess('view'), validate(
  { body: PolicyEvaluationBodySchema },
  { message: policyValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const userId = req.user!.userId;
  const { recipient, amount, outputs } = req.body;

  const result = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId,
    recipient,
    amount: BigInt(amount),
    outputs,
    preview: true, // Skip event logging for previews
  });

  res.json(result);
}));

// ========================================
// POLICY CRUD
// ========================================

/**
 * GET /:walletId/policies - List all policies for a wallet (includes inherited)
 */
router.get('/:walletId/policies', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const includeInherited = req.query.includeInherited !== 'false';

  const policies = await vaultPolicyService.listWalletPolicies(walletId, {
    includeInherited,
  });

  res.json({ policies });
}));

/**
 * GET /:walletId/policies/:policyId - Get a specific policy
 */
router.get('/:walletId/policies/:policyId', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const policy = await vaultPolicyService.getPolicyInWallet(req.params.policyId, req.params.walletId);
  res.json({ policy });
}));

/**
 * POST /:walletId/policies - Create a new policy (Owner only)
 */
router.post('/:walletId/policies', requireWalletAccess('owner'), validate({ body: PolicyMutationBodySchema }), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const userId = req.user!.userId;

  const input: CreatePolicyInput = {
    walletId,
    name: req.body.name,
    description: req.body.description,
    type: req.body.type,
    config: req.body.config,
    priority: req.body.priority,
    enforcement: req.body.enforcement,
    enabled: req.body.enabled,
  };

  const policy = await vaultPolicyService.createPolicy(userId, input);

  await auditService.logFromRequest(req, AuditAction.POLICY_CREATE, AuditCategory.WALLET, {
    details: {
      walletId,
      policyId: policy.id,
      policyName: policy.name,
      policyType: policy.type,
    },
  });

  res.status(201).json({ policy });
}));

/**
 * PATCH /:walletId/policies/:policyId - Update a policy (Owner only)
 */
router.patch('/:walletId/policies/:policyId', requireWalletAccess('owner'), validate({ body: PolicyMutationBodySchema }), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;
  const userId = req.user!.userId;

  // Verify the policy belongs to this wallet
  await vaultPolicyService.getPolicyInWallet(policyId, walletId);

  const input: UpdatePolicyInput = {
    ...(req.body.name !== undefined && { name: req.body.name }),
    ...(req.body.description !== undefined && { description: req.body.description }),
    ...(req.body.config !== undefined && { config: req.body.config }),
    ...(req.body.priority !== undefined && { priority: req.body.priority }),
    ...(req.body.enforcement !== undefined && { enforcement: req.body.enforcement }),
    ...(req.body.enabled !== undefined && { enabled: req.body.enabled }),
  };

  const policy = await vaultPolicyService.updatePolicy(policyId, userId, input);

  await auditService.logFromRequest(req, AuditAction.POLICY_UPDATE, AuditCategory.WALLET, {
    details: {
      walletId,
      policyId,
      updatedFields: Object.keys(input),
    },
  });

  res.json({ policy });
}));

/**
 * DELETE /:walletId/policies/:policyId - Delete a policy (Owner only, wallet-level only)
 */
router.delete('/:walletId/policies/:policyId', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;

  await vaultPolicyService.deletePolicy(policyId, walletId);

  await auditService.logFromRequest(req, AuditAction.POLICY_DELETE, AuditCategory.WALLET, {
    details: {
      walletId,
      policyId,
    },
  });

  res.json({ success: true });
}));

// ========================================
// POLICY ADDRESSES
// ========================================

/**
 * GET /:walletId/policies/:policyId/addresses - List policy addresses
 */
router.get('/:walletId/policies/:policyId/addresses', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;
  const listType = req.query.listType as string | undefined;

  const addresses = await vaultPolicyService.listPolicyAddressesInWallet(
    policyId,
    walletId,
    listType === 'allow' || listType === 'deny' ? listType : undefined
  );

  res.json({ addresses });
}));

/**
 * POST /:walletId/policies/:policyId/addresses - Add address to policy list
 */
router.post('/:walletId/policies/:policyId/addresses', requireWalletAccess('owner'), validate(
  { body: PolicyAddressBodySchema },
  { message: policyValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;
  const userId = req.user!.userId;

  const { address, label, listType } = req.body;

  const policyAddress = await vaultPolicyService.createPolicyAddressInWallet(
    policyId,
    walletId,
    userId,
    { address, label, listType }
  );

  res.status(201).json({ address: policyAddress });
}));

/**
 * DELETE /:walletId/policies/:policyId/addresses/:addressId - Remove address from policy list
 */
router.delete('/:walletId/policies/:policyId/addresses/:addressId', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const { walletId, policyId, addressId } = req.params;

  await vaultPolicyService.removePolicyAddressFromWallet(policyId, walletId, addressId);
  res.json({ success: true });
}));

export default router;
