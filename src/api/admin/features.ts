/**
 * Admin Feature Flags API
 *
 * Feature flag management endpoints (admin only)
 */

import apiClient from '../client';
import type { FeatureFlagInfo, FeatureFlagAuditResult } from './types';

/**
 * Get all feature flags
 */
export async function getFeatureFlags(): Promise<FeatureFlagInfo[]> {
  return apiClient.get<FeatureFlagInfo[]>('/admin/features');
}

/**
 * Update a feature flag
 */
export async function updateFeatureFlag(
  key: string,
  enabled: boolean,
  reason?: string
): Promise<FeatureFlagInfo> {
  return apiClient.patch<FeatureFlagInfo>(`/admin/features/${key}`, { enabled, reason });
}

/**
 * Reset a feature flag to its environment default
 */
export async function resetFeatureFlag(key: string): Promise<FeatureFlagInfo> {
  return apiClient.post<FeatureFlagInfo>(`/admin/features/${key}/reset`);
}

/**
 * Get feature flag audit log
 */
export async function getFeatureFlagAuditLog(
  key?: string,
  limit?: number
): Promise<FeatureFlagAuditResult> {
  return apiClient.get<FeatureFlagAuditResult>('/admin/features/audit-log', {
    key: key || undefined,
    limit: limit || undefined,
  });
}
