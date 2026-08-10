/**
 * Persistent feature flags with atomic durable generations, complete-snapshot
 * caches, cross-process convergence, and an audit trail.
 */

import { createHash } from 'node:crypto';
import { getConfig, type FeatureFlags, type FeatureFlagKey } from '../config';
import { flattenFeatureFlags, getFeatureFlagValue } from '../config/features';
import { featureFlagRepository } from '../repositories';
import { getDistributedCache, getDistributedEventBus } from '../infrastructure';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { getFeatureFlagDefinition } from './featureFlags/definitions';
import { FEATURE_FLAG_CACHE_TTL_SECONDS } from '../constants';
import type { FeatureRuntimeState } from '../repositories/featureFlagRepository';
import {
  FEATURE_RUNTIME_HEARTBEAT_INTERVAL_MS,
  FEATURE_RUNTIME_POLL_INTERVAL_MS,
  FeatureRuntimeParticipants,
  type FeatureRuntimeRole,
  type FeatureRuntimeSnapshot,
} from './featureFlagRuntime';

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
  private snapshot: FeatureRuntimeSnapshot | null = null;
  private runtimeRole: FeatureRuntimeRole = 'backend';
  private runtimeParticipant: FeatureRuntimeParticipants | null = null;
  private reconcileAfterInstall: (() => Promise<void>) | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  configureRuntime(
    role: FeatureRuntimeRole,
    reconcileAfterInstall?: () => Promise<void>,
  ): void {
    if (this.initialized) throw new Error('Feature runtime must be configured before initialization');
    this.runtimeRole = role;
    this.reconcileAfterInstall = reconcileAfterInstall ?? null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing feature flag service');

    const envFlags = this.getEnvironmentFlags(getConfig().features);
    const defaults = Object.entries(envFlags).map(([key, enabled]) => {
      const meta = getFeatureFlagDefinition(key);
      return {
        key,
        enabled,
        description: meta?.description ?? null,
        category: meta?.category ?? 'general',
        modifiedBy: 'system',
      };
    });
    const state = await featureFlagRepository.ensureDefaults(defaults);
    this.runtimeParticipant = new FeatureRuntimeParticipants(this.runtimeRole);
    await this.installStateStrict(state);
    await this.runtimeParticipant.heartbeat();
    await this.runtimeParticipant.acknowledge(this.snapshot!);
    this.registerEventListener();
    this.startRuntimeTimers();
    this.initialized = true;
    log.info('Feature flag service initialized', {
      flagCount: this.localCache.size,
      generation: this.snapshot?.generation,
      participantId: this.runtimeParticipant.participantId,
    });
  }

  private getEnvironmentFlags(features: FeatureFlags): Record<string, boolean> {
    return flattenFeatureFlags(features);
  }

  private async installStateStrict(state: FeatureRuntimeState): Promise<FeatureRuntimeSnapshot> {
    const next = this.createSnapshot(state);
    if (this.snapshot && BigInt(next.generation) < BigInt(this.snapshot.generation)) {
      return this.snapshot;
    }
    if (this.snapshot?.generation === next.generation && this.snapshot.digest !== next.digest) {
      throw new Error(`Feature runtime digest mismatch at generation ${next.generation}`);
    }
    if (this.snapshot?.digest === next.digest && this.snapshot.generation === next.generation) {
      return this.snapshot;
    }
    this.localCache = new Map(Object.entries(next.flags));
    await getDistributedCache().set(CACHE_KEY, next, CACHE_TTL);
    if (this.reconcileAfterInstall) await this.reconcileAfterInstall();
    this.snapshot = next;
    return next;
  }

  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    // Try local cache first
    if (this.localCache.has(key)) {
      return this.localCache.get(key)!;
    }

    // Try distributed cache
    try {
      const cache = getDistributedCache();
      const cached = await cache.get<FeatureRuntimeSnapshot>(CACHE_KEY);
      if (cached && key in cached.flags) {
        await this.installSnapshotStrict(cached);
        return cached.flags[key];
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
    return getFeatureFlagValue(config.features, key);
  }

  async setFlag(key: FeatureFlagKey, enabled: boolean, options: SetFlagOptions): Promise<void> {
    // Use repository's atomic set+audit method to avoid TOCTOU race
    const result = await featureFlagRepository.setFlagWithAudit(key, enabled, {
      userId: options.userId,
      reason: options.reason,
      ipAddress: options.ipAddress,
    });

    if (result.previousValue === null) {
      log.debug(`Feature flag ${key} already set to ${enabled}`);
      return;
    }

    const snapshot = await this.installStateStrict(result);
    await this.runtimeParticipant?.acknowledge(snapshot);

    // Emit cross-process event for cache coherence and worker reactions
    const bus = getDistributedEventBus();
    await bus.emitAsync('system:featureFlag.changed', {
      key,
      enabled,
      previousValue: result.previousValue,
      changedBy: options.userId,
      generation: snapshot.generation,
      digest: snapshot.digest,
      snapshot: snapshot.flags,
    });

    log.info('Feature flag updated', {
      key,
      previousValue: result.previousValue,
      newValue: enabled,
      changedBy: options.userId,
      reason: options.reason,
    });
  }

  async reconcileAfterRestore(state: FeatureRuntimeState): Promise<void> {
    if (!this.runtimeParticipant) throw new Error('Feature runtime is not initialized');
    const roster = await this.runtimeParticipant.freezeLiveRoster();
    const snapshot = await this.installStateStrict(state);
    await this.runtimeParticipant.heartbeat();
    await this.runtimeParticipant.acknowledge(snapshot);
    await getDistributedEventBus().emitAsync('system:featureFlag.changed', {
      key: '*',
      enabled: false,
      previousValue: false,
      changedBy: 'backup-restore',
      generation: snapshot.generation,
      digest: snapshot.digest,
      snapshot: snapshot.flags,
    });
    await this.runtimeParticipant.waitForAcknowledgements(snapshot, roster);
  }

  shutdownRuntime(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
  }

  private createSnapshot(state: FeatureRuntimeState): FeatureRuntimeSnapshot {
    const flags: Record<string, boolean> = {
      ...this.getEnvironmentFlags(getConfig().features),
    };
    for (const flag of state.flags) flags[flag.key] = flag.enabled;
    const canonicalFlags = Object.fromEntries(
      Object.entries(flags).sort(([left], [right]) => compareFlagKeys(left, right)),
    );
    const digest = createHash('sha256').update(JSON.stringify(canonicalFlags)).digest('hex');
    return { generation: state.generation, digest, flags: canonicalFlags };
  }

  private async installSnapshotStrict(snapshot: FeatureRuntimeSnapshot): Promise<void> {
    const digest = createHash('sha256').update(JSON.stringify(snapshot.flags)).digest('hex');
    if (digest !== snapshot.digest) throw new Error('Feature runtime snapshot digest is invalid');
    const state = {
      generation: snapshot.generation,
      flags: Object.entries(snapshot.flags).map(([key, enabled]) => ({ key, enabled })),
    } as FeatureRuntimeState;
    const installed = await this.installStateStrict(state);
    await this.runtimeParticipant?.heartbeat();
    await this.runtimeParticipant?.acknowledge(installed);
  }

  private registerEventListener(): void {
    if (this.eventListenerRegistered) return;
    getDistributedEventBus().on('system:featureFlag.changed', (event) => {
      if (!event.snapshot) return;
      void this.installSnapshotStrict({
        generation: event.generation,
        digest: event.digest,
        flags: event.snapshot,
      }).catch((error) => {
        log.error('Failed to install feature runtime event snapshot', {
          error: getErrorMessage(error),
        });
      });
    });
    this.eventListenerRegistered = true;
  }

  private startRuntimeTimers(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.runtimeParticipant?.heartbeat().catch((error) => {
        log.error('Feature runtime heartbeat failed', { error: getErrorMessage(error) });
      });
    }, FEATURE_RUNTIME_HEARTBEAT_INTERVAL_MS);
    this.pollTimer = setInterval(() => {
      void this.pollRuntimeState().catch((error) => {
        log.error('Feature runtime polling failed', { error: getErrorMessage(error) });
      });
    }, FEATURE_RUNTIME_POLL_INTERVAL_MS);
    this.heartbeatTimer.unref();
    this.pollTimer.unref();
  }

  private async pollRuntimeState(): Promise<void> {
    const state = await featureFlagRepository.loadRuntimeState();
    if (!this.snapshot || BigInt(state.generation) > BigInt(this.snapshot.generation)) {
      await this.installStateStrict(state);
    }
    // The branch above either retained an existing snapshot or installed one.
    const snapshot = this.snapshot!;
    await this.runtimeParticipant?.heartbeat();
    await this.runtimeParticipant?.acknowledge(snapshot);
  }

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

  async resetToDefault(key: FeatureFlagKey, options: SetFlagOptions): Promise<void> {
    const config = getConfig();
    const defaultValue = getFeatureFlagValue(config.features, key);

    await this.setFlag(key, defaultValue, {
      ...options,
      reason: options.reason || 'Reset to environment default',
    });
  }

  async bulkUpdate(
    updates: Array<{ key: FeatureFlagKey; enabled: boolean }>,
    options: SetFlagOptions
  ): Promise<void> {
    for (const update of updates) {
      await this.setFlag(update.key, update.enabled, options);
    }
  }
}

function compareFlagKeys(left: string, right: string): number {
  /* v8 ignore next -- createSnapshot derives unique object keys. */
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// =============================================================================
// Singleton
// =============================================================================

export const featureFlagService = new FeatureFlagService();

export default featureFlagService;
