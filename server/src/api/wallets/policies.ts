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
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();

const MAX_PAGE_LIMIT = 200;

/** Pagination with clamping for policy events (max 200) */
const PolicyEventPaginationSchema = z.object({
  limit: z.coerce.number().int().catch(50).transform(v => Math.max(1, Math.min(v, MAX_PAGE_LIMIT))),
  offset: z.coerce.number().int().catch(0).transform(v => Math.max(0, v)),
});

const PolicyIntegerAmountSchema = z.custom<number | string>(
  (value) => (
    (typeof value === 'number' && Number.isInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^\d+$/.test(value))
  ),
  { message: 'amount must be a valid non-negative integer' }
);

const PolicyEvaluationOutputSchema = z.object({
  address: z.string().min(1),
  amount: z.number().int().nonnegative(),
}).strict();

const PolicyEvaluationBodySchema = z
  .object({
    recipient: z.string().min(1).optional(),
    amount: PolicyIntegerAmountSchema.optional(),
    outputs: z.array(PolicyEvaluationOutputSchema).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.recipient || data.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'recipient and amount are required',
        path: ['recipient'],
      });
      return;
    }
  });

const PolicyNameSchema = z.string()
  .min(1, 'Policy name is required')
  .max(100, 'Policy name must be 100 characters or fewer')
  .refine((value) => value.trim().length > 0, 'Policy name is required');

const PolicyEnforcementSchema = z.enum(['enforce', 'monitor']);
const PolicyScopeSchema = z.enum(['wallet', 'per_user']);
const PolicyLimitSchema = z.number().int().nonnegative();
const PositivePolicyLimitSchema = z.number().int().positive();
const PolicyRoleListSchema = z.array(z.string().min(1));

const hasPositiveLimit = (...limits: Array<number | undefined>) =>
  limits.some((limit) => limit !== undefined && limit > 0);

const SpendingLimitConfigSchema = z.object({
  perTransaction: PolicyLimitSchema.optional(),
  daily: PolicyLimitSchema.optional(),
  weekly: PolicyLimitSchema.optional(),
  monthly: PolicyLimitSchema.optional(),
  scope: PolicyScopeSchema,
  exemptRoles: PolicyRoleListSchema.optional(),
}).strict().refine(
  (config) => hasPositiveLimit(config.perTransaction, config.daily, config.weekly, config.monthly),
  { message: 'spending_limit config requires at least one non-zero limit' }
);

const ApprovalTriggerSchema = z.object({
  always: z.boolean().optional(),
  amountAbove: PositivePolicyLimitSchema.optional(),
  unknownAddressesOnly: z.boolean().optional(),
}).strict().refine(
  (trigger) => trigger.always === true || trigger.amountAbove !== undefined || trigger.unknownAddressesOnly === true,
  { message: 'approval_required trigger must specify at least one condition' }
);

const ApprovalRequiredConfigSchema = z.object({
  trigger: ApprovalTriggerSchema,
  requiredApprovals: z.number().int().positive(),
  quorumType: z.enum(['any_n', 'specific', 'all']),
  specificApprovers: z.array(z.string().min(1)).optional(),
  allowSelfApproval: z.boolean(),
  expirationHours: z.number().int().nonnegative(),
}).strict().superRefine((config, ctx) => {
  if (config.quorumType === 'specific' && !config.specificApprovers?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'specific quorum requires specificApprovers array',
      path: ['specificApprovers'],
    });
  }
});

const TimeDelayTriggerSchema = z.object({
  always: z.boolean().optional(),
  amountAbove: PositivePolicyLimitSchema.optional(),
}).strict().refine(
  (trigger) => trigger.always === true || trigger.amountAbove !== undefined,
  { message: 'time_delay trigger must specify at least one condition' }
);

const TimeDelayConfigSchema = z.object({
  trigger: TimeDelayTriggerSchema,
  delayHours: z.number().positive().max(168),
  vetoEligible: z.enum(['any_approver', 'specific']),
  specificVetoers: z.array(z.string().min(1)).optional(),
  notifyOnStart: z.boolean(),
  notifyOnVeto: z.boolean(),
  notifyOnClear: z.boolean(),
}).strict().superRefine((config, ctx) => {
  if (config.vetoEligible === 'specific' && !config.specificVetoers?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'specific veto eligibility requires specificVetoers array',
      path: ['specificVetoers'],
    });
  }
});

const AddressControlConfigSchema = z.object({
  mode: z.enum(['allowlist', 'denylist']),
  allowSelfSend: z.boolean(),
  managedBy: z.enum(['owner_only', 'approvers']),
}).strict();

const VelocityConfigSchema = z.object({
  maxPerHour: PolicyLimitSchema.optional(),
  maxPerDay: PolicyLimitSchema.optional(),
  maxPerWeek: PolicyLimitSchema.optional(),
  scope: PolicyScopeSchema,
  exemptRoles: PolicyRoleListSchema.optional(),
}).strict().refine(
  (config) => hasPositiveLimit(config.maxPerHour, config.maxPerDay, config.maxPerWeek),
  { message: 'velocity config requires at least one non-zero limit' }
);

const PolicyCreateBaseFields = {
  name: PolicyNameSchema,
  description: z.string().optional(),
  priority: z.number().int().optional(),
  enforcement: PolicyEnforcementSchema.optional(),
  enabled: z.boolean().optional(),
};

const CreatePolicyBodySchema = z.discriminatedUnion('type', [
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('spending_limit'),
    config: SpendingLimitConfigSchema,
  }).strict(),
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('approval_required'),
    config: ApprovalRequiredConfigSchema,
  }).strict(),
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('time_delay'),
    config: TimeDelayConfigSchema,
  }).strict(),
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('address_control'),
    config: AddressControlConfigSchema,
  }).strict(),
  z.object({
    ...PolicyCreateBaseFields,
    type: z.literal('velocity'),
    config: VelocityConfigSchema,
  }).strict(),
]);

const PolicyConfigSchema = z.union([
  SpendingLimitConfigSchema,
  ApprovalRequiredConfigSchema,
  TimeDelayConfigSchema,
  AddressControlConfigSchema,
  VelocityConfigSchema,
]);

const PolicyUpdateBodySchema = z.object({
  name: PolicyNameSchema.optional(),
  description: z.string().optional(),
  config: PolicyConfigSchema.optional(),
  priority: z.number().int().optional(),
  enforcement: PolicyEnforcementSchema.optional(),
  enabled: z.boolean().optional(),
}).strict();

const PolicyAddressBodySchema = z
  .object({
    address: z.string({ message: 'address must be a string of 100 characters or fewer' })
      .max(100, 'address must be a string of 100 characters or fewer')
      .optional(),
    label: z.string().optional(),
    listType: z.enum(['allow', 'deny'], { message: 'listType must be "allow" or "deny"' }).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.address || !data.listType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'address and listType are required',
        path: ['address'],
      });
      return;
    }
  });

const policyValidationMessage = (issues: Array<{ message: string }>) =>
  /* v8 ignore start -- ZodError from safeParse has at least one issue */
  issues[0]?.message ?? 'Invalid policy request';
  /* v8 ignore stop */

// ========================================
// POLICY EVENTS (must be before /:policyId to avoid "events" matching as policyId)
// ========================================

/**
 * GET /:walletId/policies/events - Get policy event log
 */
router.get('/:walletId/policies/events', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const { policyId, eventType, from, to, limit, offset } = req.query;

  /* v8 ignore next -- pagination schema catch provides defaults for malformed query input */
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
  const userId = requireAuthenticatedUser(req).userId;
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
router.post('/:walletId/policies', requireWalletAccess('owner'), validate({ body: CreatePolicyBodySchema }), asyncHandler(async (req, res) => {
  const walletId = req.params.walletId;
  const userId = requireAuthenticatedUser(req).userId;

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
router.patch('/:walletId/policies/:policyId', requireWalletAccess('owner'), validate({ body: PolicyUpdateBodySchema }), asyncHandler(async (req, res) => {
  const { walletId, policyId } = req.params;
  const userId = requireAuthenticatedUser(req).userId;

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
  const userId = requireAuthenticatedUser(req).userId;

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
