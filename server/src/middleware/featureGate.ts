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
import { getConfig } from '../config';
import type { FeatureFlagKey, FeatureFlags, ExperimentalFeatures } from '../config/types';
import { createLogger } from '../utils/logger';
import { featureFlagService } from '../services/featureFlagService';

const log = createLogger('MW:FEATURE_GATE');

/**
 * Get the value of a feature flag by key (sync fallback for config)
 * Supports nested experimental flags via dot notation
 */
function getFeatureValueFromConfig(flags: FeatureFlags, key: FeatureFlagKey): boolean {
  if (key.startsWith('experimental.')) {
    const experimentalKey = key.replace('experimental.', '') as keyof ExperimentalFeatures;
    return flags.experimental[experimentalKey] ?? false;
  }
  return flags[key as keyof Omit<FeatureFlags, 'experimental'>] ?? false;
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
      // Fallback to config on service error
      log.warn('Feature flag service error, using config fallback', { flag, error });
      const config = getConfig();
      const isEnabled = getFeatureValueFromConfig(config.features, flag);

      if (!isEnabled) {
        return res.status(403).json({
          error: 'Feature not available',
          feature: flag,
          message: `The ${flag} feature is not enabled on this server`,
        });
      }

      next();
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
      log.warn('Feature flag service error, using config fallback', { flags, error });
      const config = getConfig();
      const disabledFlags = flags.filter((flag) => !getFeatureValueFromConfig(config.features, flag));

      if (disabledFlags.length > 0) {
        return res.status(403).json({
          error: 'Features not available',
          requiredFeatures: flags,
          disabledFeatures: disabledFlags,
          message: `This endpoint requires all of these features: ${flags.join(', ')}`,
        });
      }

      next();
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
      log.warn('Feature flag service error, using config fallback', { flags, error });
      const config = getConfig();
      const hasAnyEnabled = flags.some((flag) => getFeatureValueFromConfig(config.features, flag));

      if (!hasAnyEnabled) {
        return res.status(403).json({
          error: 'Features not available',
          requiredAnyOf: flags,
          message: `This endpoint requires at least one of these features: ${flags.join(', ')}`,
        });
      }

      next();
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
    // Fallback to config
    const config = getConfig();
    return getFeatureValueFromConfig(config.features, flag);
  }
}
