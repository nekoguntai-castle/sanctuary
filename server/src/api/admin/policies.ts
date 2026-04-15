/**
 * Admin Policy API Routes
 *
 * System-wide and group-level policy management (admin only).
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser, requireAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ForbiddenError } from '../../errors/ApiError';
import { vaultPolicyService } from '../../services/vaultPolicy';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import type { CreatePolicyInput, UpdatePolicyInput } from '../../services/vaultPolicy/types';

const router = Router();

const PolicyConfigSchema = z.record(z.string(), z.unknown());
const PolicyTypeSchema = z.enum([
  'spending_limit',
  'approval_required',
  'time_delay',
  'address_control',
  'velocity',
]);
const PolicyEnforcementSchema = z.enum(['enforce', 'monitor']);

const AdminCreatePolicyBodySchema = z.object({
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  type: PolicyTypeSchema,
  config: PolicyConfigSchema,
  priority: z.number().int().optional(),
  enforcement: PolicyEnforcementSchema.optional(),
  enabled: z.boolean().optional(),
}).strict();

const AdminUpdatePolicyBodySchema = z.object({
  name: z.string().optional(),
  description: z.union([z.string(), z.null()]).optional(),
  config: PolicyConfigSchema.optional(),
  priority: z.number().int().optional(),
  enforcement: PolicyEnforcementSchema.optional(),
  enabled: z.boolean().optional(),
}).strict();

// ========================================
// SYSTEM-WIDE POLICIES
// ========================================

/**
 * GET / - List all system-wide policies
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const policies = await vaultPolicyService.getSystemPolicies();
  res.json({ policies });
}));

/**
 * POST / - Create a system-wide policy
 */
router.post('/', authenticate, requireAdmin, validate({ body: AdminCreatePolicyBodySchema }), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;

  const input: CreatePolicyInput = {
    // No walletId or groupId = system-wide
    name: req.body.name,
    description: req.body.description,
    type: req.body.type,
    config: req.body.config,
    priority: req.body.priority,
    enforcement: req.body.enforcement,
    enabled: req.body.enabled,
  };

  const policy = await vaultPolicyService.createPolicy(userId, input);

  await auditService.logFromRequest(req, AuditAction.POLICY_CREATE, AuditCategory.ADMIN, {
    details: {
      scope: 'system',
      policyId: policy.id,
      policyName: policy.name,
      policyType: policy.type,
    },
  });

  res.status(201).json({ policy });
}));

/**
 * PATCH /:policyId - Update a system-wide policy
 */
router.patch('/:policyId', authenticate, requireAdmin, validate({ body: AdminUpdatePolicyBodySchema }), asyncHandler(async (req, res) => {
  const { policyId } = req.params;
  const userId = requireAuthenticatedUser(req).userId;

  // Verify this is a system-level policy
  const existing = await vaultPolicyService.getPolicy(policyId);
  if (existing.sourceType !== 'system') {
    throw new ForbiddenError('Admin policy endpoints can only manage system-level policies');
  }

  const input: UpdatePolicyInput = {
    ...(req.body.name !== undefined && { name: req.body.name }),
    ...(req.body.description !== undefined && { description: req.body.description }),
    ...(req.body.config !== undefined && { config: req.body.config }),
    ...(req.body.priority !== undefined && { priority: req.body.priority }),
    ...(req.body.enforcement !== undefined && { enforcement: req.body.enforcement }),
    ...(req.body.enabled !== undefined && { enabled: req.body.enabled }),
  };

  const policy = await vaultPolicyService.updatePolicy(policyId, userId, input, { isAdmin: true });

  await auditService.logFromRequest(req, AuditAction.POLICY_UPDATE, AuditCategory.ADMIN, {
    details: {
      scope: 'system',
      policyId,
      updatedFields: Object.keys(input),
    },
  });

  res.json({ policy });
}));

/**
 * DELETE /:policyId - Delete a system-wide policy
 */
router.delete('/:policyId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { policyId } = req.params;

  // Verify this is a system-level policy
  const existing = await vaultPolicyService.getPolicy(policyId);
  if (existing.sourceType !== 'system') {
    throw new ForbiddenError('Admin policy endpoints can only manage system-level policies');
  }

  await vaultPolicyService.deletePolicy(policyId);

  await auditService.logFromRequest(req, AuditAction.POLICY_DELETE, AuditCategory.ADMIN, {
    details: {
      scope: 'system',
      policyId,
    },
  });

  res.json({ success: true });
}));

// ========================================
// GROUP POLICIES (mounted under /groups/:groupId/policies by admin.ts)
// These are handled as sub-routes; see the admin router for mounting.
// ========================================

export default router;
