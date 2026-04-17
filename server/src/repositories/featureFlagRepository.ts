/**
 * Feature Flag Repository
 *
 * Abstracts database operations for feature flags and their audit trail.
 */

import prisma from '../models/prisma';
import type { FeatureFlag, FeatureFlagAudit, Prisma } from '../generated/prisma/client';

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
): Promise<boolean | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.featureFlag.findUnique({ where: { key } });
    if (!current) {
      throw new Error(`Feature flag '${key}' does not exist`);
    }

    if (current.enabled === enabled) {
      return null; // No change needed
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

    return current.enabled;
  });
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
  getAuditLog,
};

export default featureFlagRepository;
