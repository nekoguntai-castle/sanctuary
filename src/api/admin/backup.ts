/**
 * Admin Backup & Restore API
 *
 * Database backup, restore, encryption keys, and audit log API calls (admin only)
 */

import apiClient, { API_BASE_URL } from '../client';
import type {
  EncryptionKeysResponse,
  SanctuaryBackup,
  BackupOptions,
  ValidationResult,
  RestoreResult,
  AuditLogQuery,
  AuditLogResult,
  AuditLogStats,
  VersionInfo,
} from './types';

// ========================================
// ENCRYPTION KEYS
// ========================================

/**
 * Get the encryption keys for backup restoration (admin only)
 *
 * These keys are required when restoring a backup to a new instance.
 * Without matching keys, encrypted data (node passwords, 2FA) cannot be restored.
 */
export async function getEncryptionKeys(): Promise<EncryptionKeysResponse> {
  return apiClient.get<EncryptionKeysResponse>('/admin/encryption-keys');
}

// ========================================
// BACKUP & RESTORE
// ========================================

/**
 * Create and download a database backup (admin only)
 *
 * This returns a Blob for file download.
 */
export async function createBackup(options?: BackupOptions): Promise<Blob> {
  const token = apiClient.getToken();

  const response = await fetch(`${API_BASE_URL}/admin/backup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(options || {}),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Backup creation failed');
  }

  return response.blob();
}

/**
 * Create a backup and return as JSON object (for validation preview)
 */
export async function createBackupJson(options?: BackupOptions): Promise<SanctuaryBackup> {
  return apiClient.post<SanctuaryBackup>('/admin/backup', options || {});
}

/**
 * Validate a backup file before restore (admin only)
 */
export async function validateBackup(backup: SanctuaryBackup): Promise<ValidationResult> {
  return apiClient.post<ValidationResult>('/admin/backup/validate', { backup });
}

/**
 * Restore database from backup (admin only)
 *
 * WARNING: This will DELETE ALL existing data!
 */
export async function restoreBackup(backup: SanctuaryBackup): Promise<RestoreResult> {
  return apiClient.post<RestoreResult>('/admin/restore', {
    backup,
    confirmationCode: 'CONFIRM_RESTORE',
  });
}

// ========================================
// AUDIT LOGS
// ========================================

/**
 * Get audit logs with optional filters (admin only)
 */
export async function getAuditLogs(query?: AuditLogQuery): Promise<AuditLogResult> {
  const params = new URLSearchParams();
  if (query) {
    if (query.userId) params.set('userId', query.userId);
    if (query.username) params.set('username', query.username);
    if (query.action) params.set('action', query.action);
    if (query.category) params.set('category', query.category);
    if (query.success !== undefined) params.set('success', String(query.success));
    if (query.startDate) params.set('startDate', query.startDate);
    if (query.endDate) params.set('endDate', query.endDate);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));
  }
  const queryString = params.toString();
  const url = queryString ? `/admin/audit-logs?${queryString}` : '/admin/audit-logs';
  return apiClient.get<AuditLogResult>(url);
}

/**
 * Get audit log statistics (admin only)
 */
export async function getAuditLogStats(days?: number): Promise<AuditLogStats> {
  const url = days ? `/admin/audit-logs/stats?days=${days}` : '/admin/audit-logs/stats';
  return apiClient.get<AuditLogStats>(url);
}

// ========================================
// VERSION CHECK
// ========================================

/**
 * Check for application updates
 * Does not require authentication
 */
export async function checkVersion(): Promise<VersionInfo> {
  return apiClient.get<VersionInfo>('/admin/version');
}
