/**
 * Feature Flag Repository
 *
 * Abstracts database operations for feature flags and their audit trail.
 */

import prisma, { type PrismaTxClient } from '../models/prisma';
import type { FeatureFlag, FeatureFlagAudit, Prisma } from '../generated/prisma/client';
import { FEATURE_RUNTIME_GENERATION_KEY } from './operationalSystemSettings';

export { FEATURE_RUNTIME_GENERATION_KEY } from './operationalSystemSettings';

export interface FeatureRuntimeState {
  generation: string;
  flags: FeatureFlag[];
}

export interface SetFlagResult extends FeatureRuntimeState {
  previousValue: boolean | null;
}

/**
 * Find a feature flag by key
 */
export async function findByKey(key: string): Promise<FeatureFlag | null> {
  return prisma.featureFlag.findUnique({ where: { key } });
}

/**
 * Find all feature flags, ordered by category then key
 */
export async function findAll(): Promise<FeatureFlag[]> {
  return prisma.featureFlag.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });
}

/**
 * Create a feature flag
 */
export async function create(data: {
  key: string;
  enabled: boolean;
  description?: string | null;
  category?: string;
  modifiedBy?: string;
}): Promise<FeatureFlag> {
  return prisma.featureFlag.create({
    data: {
      key: data.key,
      enabled: data.enabled,
      description: data.description ?? null,
      /* v8 ignore start -- repository defaults are defensive for callers outside the service */
      category: data.category ?? 'general',
      modifiedBy: data.modifiedBy ?? 'system',
      /* v8 ignore stop */
    },
  });
}

/**
 * Toggle a feature flag and create an audit entry atomically.
 * Returns null if the flag doesn't exist, or the previous value
 * (null when enabled already matches).
 */
export async function setFlagWithAudit(
  key: string,
  enabled: boolean,
  options: { userId: string; reason?: string; ipAddress?: string }
): Promise<SetFlagResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.featureFlag.findUnique({ where: { key } });
    if (!current) {
      throw new Error(`Feature flag '${key}' does not exist`);
    }

    if (current.enabled === enabled) {
      return {
        previousValue: null,
        ...(await loadRuntimeStateInTransaction(tx)),
      };
    }

    await tx.featureFlag.update({
      where: { key },
      data: {
        enabled,
        modifiedBy: options.userId,
      },
    });

    await tx.featureFlagAudit.create({
      data: {
        featureFlagId: current.id,
        key,
        previousValue: current.enabled,
        newValue: enabled,
        changedBy: options.userId,
        reason: options.reason,
        ipAddress: options.ipAddress,
      },
    });

    const generation = await advanceGeneration(tx);
    const flags = await findAllInTransaction(tx);
    return { previousValue: current.enabled, generation, flags };
  }, { isolationLevel: 'Serializable' });
}

export async function ensureDefaults(defaults: Array<{
  key: string;
  enabled: boolean;
  description: string | null;
  category: string;
  modifiedBy: string;
}>): Promise<FeatureRuntimeState> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.featureFlag.findMany({ select: { key: true } });
    const existingKeys = new Set(existing.map(({ key }) => key));
    const missing = defaults.filter(({ key }) => !existingKeys.has(key));
    if (missing.length > 0) {
      await tx.featureFlag.createMany({ data: missing, skipDuplicates: true });
      const generation = await advanceGeneration(tx);
      return { generation, flags: await findAllInTransaction(tx) };
    }
    return loadRuntimeStateInTransaction(tx);
  }, { isolationLevel: 'Serializable' });
}

export async function loadRuntimeState(): Promise<FeatureRuntimeState> {
  return prisma.$transaction(
    (tx) => loadRuntimeStateInTransaction(tx),
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function readGeneration(tx: PrismaTxClient): Promise<string> {
  const setting = await tx.systemSetting.findUnique({
    where: { key: FEATURE_RUNTIME_GENERATION_KEY },
    select: { value: true },
  });
  return normalizeGeneration(setting?.value);
}

export async function advanceGeneration(
  tx: PrismaTxClient,
  minimumGeneration = '0',
): Promise<string> {
  await tx.systemSetting.upsert({
    where: { key: FEATURE_RUNTIME_GENERATION_KEY },
    create: { key: FEATURE_RUNTIME_GENERATION_KEY, value: normalizeGeneration(minimumGeneration) },
    update: {},
  });
  const current = await readGeneration(tx);
  const next = (maxGeneration(current, minimumGeneration) + 1n).toString();
  await tx.systemSetting.update({
    where: { key: FEATURE_RUNTIME_GENERATION_KEY },
    data: { value: next },
  });
  return next;
}

export async function loadRuntimeStateInTransaction(
  tx: PrismaTxClient,
): Promise<FeatureRuntimeState> {
  const generation = await readGeneration(tx);
  return { generation, flags: await findAllInTransaction(tx) };
}

async function findAllInTransaction(tx: PrismaTxClient): Promise<FeatureFlag[]> {
  return tx.featureFlag.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
}

function normalizeGeneration(value: string | undefined): string {
  if (value === undefined) return '0';
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid feature runtime generation '${value}'`);
  }
  return BigInt(value).toString();
}

function maxGeneration(left: string, right: string): bigint {
  const leftValue = BigInt(normalizeGeneration(left));
  const rightValue = BigInt(normalizeGeneration(right));
  return leftValue > rightValue ? leftValue : rightValue;
}

/**
 * Get audit log entries, optionally filtered by key
 */
export async function getAuditLog(
  key?: string,
  limit = 50,
  offset = 0
): Promise<FeatureFlagAudit[]> {
  return prisma.featureFlagAudit.findMany({
    where: key ? { key } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

// Export as namespace
export const featureFlagRepository = {
  findByKey,
  findAll,
  create,
  setFlagWithAudit,
  ensureDefaults,
  loadRuntimeState,
  readGeneration,
  advanceGeneration,
  loadRuntimeStateInTransaction,
  getAuditLog,
};

export default featureFlagRepository;
