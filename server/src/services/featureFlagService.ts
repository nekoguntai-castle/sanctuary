/**
 * Feature Flag Service
 *
 * Persistent feature flags with database storage and audit trail.
 * Supports runtime toggling while respecting environment defaults.
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────┐
 * │                   Feature Flag Service                   │
 * ├─────────────────────────────────────────────────────────┤
 * │  1. Environment defaults (config)                       │
 * │  2. Database overrides (persistent)                     │
 * │  3. Runtime cache (fast lookups)                        │
 * └─────────────────────────────────────────────────────────┘
 *                           │
 *                           ▼
 * ┌─────────────────────────────────────────────────────────┐
 * │                    Audit Trail                           │
 * │  - Who changed what                                      │
 * │  - Previous/new values                                   │
 * │  - Timestamps & IP addresses                             │
 * └─────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * // Check if feature is enabled
 * const enabled = await featureFlagService.isEnabled('aiAssistant');
 *
 * // Toggle a feature (admin only)
 * await featureFlagService.setFlag('aiAssistant', true, {
 *   userId: 'admin-123',
 *   reason: 'Enabling AI for beta testing',
 *   ipAddress: req.ip,
 * });
 *
 * // Get audit history
 * const history = await featureFlagService.getAuditLog('aiAssistant');
 * ```
 */

import { getConfig, type FeatureFlags, type FeatureFlagKey, type ExperimentalFeatures } from '../config';
import { featureFlagRepository } from '../repositories';
import { getDistributedCache, getDistributedEventBus } from '../infrastructure';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { getFeatureFlagDefinition } from './featureFlags/definitions';
import { FEATURE_FLAG_CACHE_TTL_SECONDS } from '../constants';

const log = createLogger('FEATURE_FLAG:SVC');

// =============================================================================
// Types
// =============================================================================

export interface FeatureFlagInfo {
  key: string;
  enabled: boolean;
  description: string | null;
  category: string;
  source: 'environment' | 'database';
  modifiedBy: string | null;
  updatedAt: Date | null;
  hasSideEffects?: boolean;
  sideEffectDescription?: string | null;
}

export interface SetFlagOptions {
  userId: string;
  reason?: string;
  ipAddress?: string;
}

export interface AuditEntry {
  id: string;
  key: string;
  previousValue: boolean;
  newValue: boolean;
  changedBy: string;
  reason: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

// =============================================================================
// Feature Flag Definitions
// =============================================================================

// =============================================================================
// Cache
// =============================================================================

const CACHE_KEY = 'feature:flags';
const CACHE_TTL = FEATURE_FLAG_CACHE_TTL_SECONDS;

// =============================================================================
// Service
// =============================================================================

class FeatureFlagService {
  private initialized = false;
  private localCache: Map<string, boolean> = new Map();
  private eventListenerRegistered = false;

  /**
   * Initialize the service - sync environment defaults to database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing feature flag service');

    try {
      const config = getConfig();

      // Get all environment-defined flags
      const envFlags = this.getEnvironmentFlags(config.features);

      // Sync to database (insert if not exists)
      for (const [key, enabled] of Object.entries(envFlags)) {
        const existing = await featureFlagRepository.findByKey(key);

        if (!existing) {
          const meta = getFeatureFlagDefinition(key);
          await featureFlagRepository.create({
            key,
            enabled,
            description: meta?.description ?? null,
            category: meta?.category ?? 'general',
            modifiedBy: 'system',
          });
          log.debug(`Created feature flag: ${key} = ${enabled}`);
        }
      }

      // Subscribe to cross-process flag change events (idempotent)
      if (!this.eventListenerRegistered) {
        const bus = getDistributedEventBus();
        bus.on('system:featureFlag.changed', ({ key, enabled }) => {
          log.debug('Received feature flag change event', { key, enabled });
          this.localCache.set(key, enabled);
        });
        this.eventListenerRegistered = true;
      }

      // Load all flags into local cache
      await this.refreshCache();

      this.initialized = true;
      log.info('Feature flag service initialized', {
        flagCount: this.localCache.size,
      });
    } catch (error) {
      log.error('Failed to initialize feature flag service', { error: getErrorMessage(error) });
      // Fall back to environment-only mode
      this.initialized = true;
    }
  }

  /**
   * Get environment-defined flags as flat key-value pairs
   */
  private getEnvironmentFlags(features: FeatureFlags): Record<string, boolean> {
    const flags: Record<string, boolean> = {};

    // Top-level flags
    const topLevel = ['hardwareWalletSigning', 'qrCodeSigning', 'multisigWallets',
      'batchSync', 'payjoinSupport', 'batchTransactions', 'rbfTransactions',
      'priceAlerts', 'aiAssistant', 'sanctuaryConsole', 'telegramNotifications',
      'websocketV2Events', 'treasuryAutopilot', 'treasuryIntelligence'] as const;

    for (const key of topLevel) {
      flags[key] = features[key];
    }

    // Experimental flags
    const experimental = ['taprootAddresses', 'silentPayments', 'coinJoin'] as const;
    for (const key of experimental) {
      flags[`experimental.${key}`] = features.experimental[key];
    }

    return flags;
  }

  /**
   * Refresh the local cache from database
   */
  private async refreshCache(): Promise<void> {
    try {
      const flags = await featureFlagRepository.findAll();

      this.localCache.clear();
      for (const flag of flags) {
        this.localCache.set(flag.key, flag.enabled);
      }

      // Also update distributed cache
      const cache = getDistributedCache();
      await cache.set(CACHE_KEY, Object.fromEntries(this.localCache), CACHE_TTL);
    } catch (error) {
      log.error('Failed to refresh feature flag cache', { error: getErrorMessage(error) });
    }
  }

  /**
   * Check if a feature is enabled
   */
  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    // Try local cache first
    if (this.localCache.has(key)) {
      return this.localCache.get(key)!;
    }

    // Try distributed cache
    try {
      const cache = getDistributedCache();
      const cached = await cache.get<Record<string, boolean>>(CACHE_KEY);
      if (cached && key in cached) {
        this.localCache.set(key, cached[key]);
        return cached[key];
      }
    } catch (error) {
      log.debug('Cache lookup failed, continuing to database', { error: getErrorMessage(error) });
    }

    // Fall back to database
    try {
      const flag = await featureFlagRepository.findByKey(key);
      if (flag) {
        this.localCache.set(key, flag.enabled);
        return flag.enabled;
      }
    } catch (error) {
      log.debug('Database lookup failed, continuing to environment fallback', { error: getErrorMessage(error) });
    }

    // Final fallback: environment config
    const config = getConfig();
    if (key.startsWith('experimental.')) {
      const expKey = key.replace('experimental.', '') as keyof ExperimentalFeatures;
      return config.features.experimental[expKey] ?? false;
    }
    return config.features[key as keyof Omit<FeatureFlags, 'experimental'>] ?? false;
  }

  /**
   * Set a feature flag value
   */
  async setFlag(key: FeatureFlagKey, enabled: boolean, options: SetFlagOptions): Promise<void> {
    // Use repository's atomic set+audit method to avoid TOCTOU race
    const previousValue = await featureFlagRepository.setFlagWithAudit(key, enabled, {
      userId: options.userId,
      reason: options.reason,
      ipAddress: options.ipAddress,
    });

    if (previousValue === null) {
      log.debug(`Feature flag ${key} already set to ${enabled}`);
      return;
    }

    // Invalidate caches
    this.localCache.set(key, enabled);
    const cache = getDistributedCache();
    await cache.delete(CACHE_KEY);

    // Emit cross-process event for cache coherence and worker reactions
    const bus = getDistributedEventBus();
    bus.emit('system:featureFlag.changed', {
      key,
      enabled,
      previousValue,
      changedBy: options.userId,
    });

    log.info('Feature flag updated', {
      key,
      previousValue,
      newValue: enabled,
      changedBy: options.userId,
      reason: options.reason,
    });
  }

  /**
   * Get all feature flags with metadata
   */
  async getAllFlags(): Promise<FeatureFlagInfo[]> {
    const flags = await featureFlagRepository.findAll();

    return flags.map((flag) => {
      const definition = getFeatureFlagDefinition(flag.key);

      return {
        key: flag.key,
        enabled: flag.enabled,
        description: flag.description,
        category: flag.category,
        source: 'database' as const,
        modifiedBy: flag.modifiedBy,
        updatedAt: flag.updatedAt,
        hasSideEffects: definition?.hasSideEffects,
        sideEffectDescription: definition?.sideEffectDescription ?? null,
      };
    });
  }

  /**
   * Get audit log for a specific flag or all flags
   */
  async getAuditLog(key?: string, limit = 50, offset = 0): Promise<AuditEntry[]> {
    const entries = await featureFlagRepository.getAuditLog(key, limit, offset);

    return entries.map((entry) => ({
      id: entry.id,
      key: entry.key,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      changedBy: entry.changedBy,
      reason: entry.reason,
      ipAddress: entry.ipAddress,
      createdAt: entry.createdAt,
    }));
  }

  /**
   * Get flag info by key
   */
  async getFlag(key: FeatureFlagKey): Promise<FeatureFlagInfo | null> {
    const flag = await featureFlagRepository.findByKey(key);

    if (!flag) return null;

    const definition = getFeatureFlagDefinition(flag.key);

    return {
      key: flag.key,
      enabled: flag.enabled,
      description: flag.description,
      category: flag.category,
      source: 'database',
      modifiedBy: flag.modifiedBy,
      updatedAt: flag.updatedAt,
      hasSideEffects: definition?.hasSideEffects,
      sideEffectDescription: definition?.sideEffectDescription ?? null,
    };
  }

  /**
   * Reset a flag to its environment default
   */
  async resetToDefault(key: FeatureFlagKey, options: SetFlagOptions): Promise<void> {
    const config = getConfig();
    let defaultValue: boolean;

    if (key.startsWith('experimental.')) {
      const expKey = key.replace('experimental.', '') as keyof ExperimentalFeatures;
      defaultValue = config.features.experimental[expKey] ?? false;
    } else {
      defaultValue = config.features[key as keyof Omit<FeatureFlags, 'experimental'>] ?? false;
    }

    await this.setFlag(key, defaultValue, {
      ...options,
      reason: options.reason || 'Reset to environment default',
    });
  }

  /**
   * Bulk update multiple flags
   */
  async bulkUpdate(
    updates: Array<{ key: FeatureFlagKey; enabled: boolean }>,
    options: SetFlagOptions
  ): Promise<void> {
    for (const update of updates) {
      await this.setFlag(update.key, update.enabled, options);
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

export const featureFlagService = new FeatureFlagService();

export default featureFlagService;
