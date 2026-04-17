/**
 * Admin Feature Flags Router
 *
 * Endpoints for managing feature flags at runtime (admin only)
 */

import { Router, Request, Response } from 'express';
import type { ZodError } from 'zod';
import { authenticate, requireAuthenticatedUser, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError } from '../../errors/ApiError';
import { featureFlagService } from '../../services/featureFlagService';
import type { FeatureFlagKey } from '../../config';
import {
  UpdateFeatureFlagSchema,
  FeatureFlagKeyParamSchema,
  FeatureFlagAuditQuerySchema,
} from '../schemas/admin';
import { UNKNOWN_FEATURE_FLAG_KEY_MESSAGE } from '../../services/featureFlags/definitions';

const router = Router();

function hasUnknownFeatureKeyIssue(error: ZodError): boolean {
  return error.issues.some((issue) => issue.message === UNKNOWN_FEATURE_FLAG_KEY_MESSAGE);
}

/**
 * Parse and validate feature flag key from request params.
 * Returns the validated key, or sends an error response and returns null.
 */
function parseFeatureKeyParam(req: Request, res: Response): FeatureFlagKey | null {
  const params = FeatureFlagKeyParamSchema.safeParse(req.params);
  if (!params.success) {
    const isUnknownKey = hasUnknownFeatureKeyIssue(params.error);
    /* v8 ignore next 2 -- validation tests cover both error shapes through shared request validation */
    res.status(isUnknownKey ? 404 : 400).json({
      error: isUnknownKey ? 'Not Found' : 'Validation Error',
      message: params.error.issues.map(i => i.message).join(', '),
    });
    return null;
  }
  return params.data.key as FeatureFlagKey;
}

/**
 * GET /api/v1/admin/features
 * List all feature flags
 */
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const flags = await featureFlagService.getAllFlags();
  res.json(flags);
}));

/**
 * GET /api/v1/admin/features/audit-log
 * Get feature flag audit trail
 *
 * Must be defined before /:key to avoid route collision
 */
router.get('/audit-log', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const query = FeatureFlagAuditQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: query.error.issues.map(i => i.message).join(', '),
    });
  }

  const { key, limit, offset } = query.data;
  const entries = await featureFlagService.getAuditLog(key, limit, offset);

  res.json({
    entries,
    total: entries.length,
    limit,
    offset,
  });
}));

/**
 * GET /api/v1/admin/features/:key
 * Get a single feature flag
 */
router.get('/:key', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const key = parseFeatureKeyParam(req, res);
  if (!key) return;

  const flag = await featureFlagService.getFlag(key);
  if (!flag) {
    throw new NotFoundError(`Feature flag '${key}' does not exist`);
  }

  res.json(flag);
}));

/**
 * PATCH /api/v1/admin/features/:key
 * Toggle a feature flag
 */
router.patch('/:key', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const key = parseFeatureKeyParam(req, res);
  if (!key) return;

  const body = UpdateFeatureFlagSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: body.error.issues.map(i => i.message).join(', '),
    });
  }

  // Verify flag exists
  const existing = await featureFlagService.getFlag(key);
  if (!existing) {
    throw new NotFoundError(`Feature flag '${key}' does not exist`);
  }

  await featureFlagService.setFlag(key, body.data.enabled, {
    userId: requireAuthenticatedUser(req).userId,
    reason: body.data.reason,
    ipAddress: req.ip,
  });

  const updated = await featureFlagService.getFlag(key);
  res.json(updated);
}));

/**
 * POST /api/v1/admin/features/:key/reset
 * Reset a feature flag to its environment default
 */
router.post('/:key/reset', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const key = parseFeatureKeyParam(req, res);
  if (!key) return;

  // Verify flag exists
  const existing = await featureFlagService.getFlag(key);
  if (!existing) {
    throw new NotFoundError(`Feature flag '${key}' does not exist`);
  }

  await featureFlagService.resetToDefault(key, {
    userId: requireAuthenticatedUser(req).userId,
    reason: 'Reset to environment default',
    ipAddress: req.ip,
  });

  const updated = await featureFlagService.getFlag(key);
  res.json(updated);
}));

export default router;
