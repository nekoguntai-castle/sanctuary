/**
 * Feature Gate Middleware
 *
 * Middleware for gating API endpoints behind feature flags.
 * Returns 403 if the requested feature is not enabled.
 *
 * Uses the persistent FeatureFlagService which supports:
 * - Database-backed flag storage
 * - Runtime toggling
 * - Audit trail for all changes
 *
 * Usage:
 *   router.post('/payjoin', requireFeature('payjoinSupport'), handler);
 *   router.post('/taproot', requireFeature('experimental.taprootAddresses'), handler);
 */

import { Request, Response, NextFunction } from 'express';
import type { FeatureFlagKey } from '../config/types';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { featureFlagService } from '../services/featureFlagService';

const log = createLogger('MW:FEATURE_GATE');

function sendFeatureFlagServiceUnavailable(
  res: Response,
  details: { feature?: FeatureFlagKey; requiredFeatures?: FeatureFlagKey[]; requiredAnyOf?: FeatureFlagKey[] }
) {
  return res.status(503).json({
    error: 'Feature flag service unavailable',
    ...details,
    message: 'Feature availability cannot be verified right now',
  });
}

/**
 * Middleware that requires a feature flag to be enabled
 *
 * @param flag - The feature flag key to check
 * @returns Express middleware that blocks request if feature is disabled
 *
 * @example
 * // Simple feature check
 * router.post('/payjoin', requireFeature('payjoinSupport'), payjoinHandler);
 *
 * // Experimental feature check
 * router.post('/taproot', requireFeature('experimental.taprootAddresses'), taprootHandler);
 */
export function requireFeature(flag: FeatureFlagKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isEnabled = await featureFlagService.isEnabled(flag);

      if (!isEnabled) {
        log.info(`Feature gate blocked request`, {
          feature: flag,
          path: req.path,
          method: req.method,
        });

        return res.status(403).json({
          error: 'Feature not available',
          feature: flag,
          message: `The ${flag} feature is not enabled on this server`,
        });
      }

      next();
    } catch (error) {
      log.error('Feature flag service error', { flag, error: getErrorMessage(error) });
      return sendFeatureFlagServiceUnavailable(res, { feature: flag });
    }
  };
}

/**
 * Middleware that requires ALL specified features to be enabled
 *
 * @param flags - Array of feature flag keys that must all be enabled
 */
export function requireAllFeatures(flags: FeatureFlagKey[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const results = await Promise.all(
        flags.map(async (flag) => ({
          flag,
          enabled: await featureFlagService.isEnabled(flag),
        }))
      );

      const disabledFlags = results.filter((r) => !r.enabled).map((r) => r.flag);

      if (disabledFlags.length > 0) {
        log.info(`Feature gate blocked request (missing features)`, {
          required: flags,
          disabled: disabledFlags,
          path: req.path,
        });

        return res.status(403).json({
          error: 'Features not available',
          requiredFeatures: flags,
          disabledFeatures: disabledFlags,
          message: `This endpoint requires all of these features: ${flags.join(', ')}`,
        });
      }

      next();
    } catch (error) {
      log.error('Feature flag service error', { flags, error: getErrorMessage(error) });
      return sendFeatureFlagServiceUnavailable(res, { requiredFeatures: flags });
    }
  };
}

/**
 * Middleware that requires ANY of the specified features to be enabled
 *
 * @param flags - Array of feature flag keys where at least one must be enabled
 */
export function requireAnyFeature(flags: FeatureFlagKey[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const results = await Promise.all(
        flags.map((flag) => featureFlagService.isEnabled(flag))
      );

      const hasAnyEnabled = results.some((enabled) => enabled);

      if (!hasAnyEnabled) {
        log.info(`Feature gate blocked request (no matching features)`, {
          anyOf: flags,
          path: req.path,
        });

        return res.status(403).json({
          error: 'Features not available',
          requiredAnyOf: flags,
          message: `This endpoint requires at least one of these features: ${flags.join(', ')}`,
        });
      }

      next();
    } catch (error) {
      log.error('Feature flag service error', { flags, error: getErrorMessage(error) });
      return sendFeatureFlagServiceUnavailable(res, { requiredAnyOf: flags });
    }
  };
}

/**
 * Check if a feature is enabled (async version using persistent service)
 *
 * @param flag - The feature flag key to check
 * @returns Promise<boolean> indicating if the feature is enabled
 *
 * @example
 * if (await isFeatureEnabledAsync('payjoinSupport')) {
 *   // Include payjoin-specific logic
 * }
 */
export async function isFeatureEnabledAsync(flag: FeatureFlagKey): Promise<boolean> {
  try {
    return await featureFlagService.isEnabled(flag);
  } catch {
    return false;
  }
}
