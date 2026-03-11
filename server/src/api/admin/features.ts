/**
 * Admin Feature Flags Router
 *
 * Endpoints for managing feature flags at runtime (admin only)
 */

import { Router, Request, Response } from 'express';
import type { ZodError } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { featureFlagService } from '../../services/featureFlagService';
import type { FeatureFlagKey } from '../../config';
import {
  UpdateFeatureFlagSchema,
  FeatureFlagKeyParamSchema,
  FeatureFlagAuditQuerySchema,
} from '../schemas/admin';
import { UNKNOWN_FEATURE_FLAG_KEY_MESSAGE } from '../../services/featureFlags/definitions';

const router = Router();
const log = createLogger('ADMIN:FEATURES');

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
router.get('/', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const flags = await featureFlagService.getAllFlags();
    res.json(flags);
  } catch (error) {
    log.error('Get feature flags error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get feature flags',
    });
  }
});

/**
 * GET /api/v1/admin/features/audit-log
 * Get feature flag audit trail
 *
 * Must be defined before /:key to avoid route collision
 */
router.get('/audit-log', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    log.error('Get feature flag audit log error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get feature flag audit log',
    });
  }
});

/**
 * GET /api/v1/admin/features/:key
 * Get a single feature flag
 */
router.get('/:key', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = parseFeatureKeyParam(req, res);
    if (!key) return;

    const flag = await featureFlagService.getFlag(key);
    if (!flag) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Feature flag '${key}' does not exist`,
      });
    }

    res.json(flag);
  } catch (error) {
    log.error('Get feature flag error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get feature flag',
    });
  }
});

/**
 * PATCH /api/v1/admin/features/:key
 * Toggle a feature flag
 */
router.patch('/:key', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
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
      return res.status(404).json({
        error: 'Not Found',
        message: `Feature flag '${key}' does not exist`,
      });
    }

    await featureFlagService.setFlag(key, body.data.enabled, {
      userId: req.user!.userId,
      reason: body.data.reason,
      ipAddress: req.ip,
    });

    const updated = await featureFlagService.getFlag(key);
    res.json(updated);
  } catch (error) {
    log.error('Update feature flag error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update feature flag',
    });
  }
});

/**
 * POST /api/v1/admin/features/:key/reset
 * Reset a feature flag to its environment default
 */
router.post('/:key/reset', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = parseFeatureKeyParam(req, res);
    if (!key) return;

    // Verify flag exists
    const existing = await featureFlagService.getFlag(key);
    if (!existing) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Feature flag '${key}' does not exist`,
      });
    }

    await featureFlagService.resetToDefault(key, {
      userId: req.user!.userId,
      reason: 'Reset to environment default',
      ipAddress: req.ip,
    });

    const updated = await featureFlagService.getFlag(key);
    res.json(updated);
  } catch (error) {
    log.error('Reset feature flag error', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to reset feature flag',
    });
  }
});

export default router;
