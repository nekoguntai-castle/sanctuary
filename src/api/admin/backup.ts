/**
 * Admin Backup & Restore API
 *
 * Database backup, restore, encryption keys, and audit log API calls (admin only)
 */

import apiClient from '../client';
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
 * Requires password re-authentication for security.
 * These keys are required when restoring a backup to a new instance.
 * Without matching keys, encrypted data (node passwords, 2FA) cannot be restored.
 */
export async function getEncryptionKeys(password: string): Promise<EncryptionKeysResponse> {
  return apiClient.post<EncryptionKeysResponse>('/admin/encryption-keys', { password });
}

// ========================================
// BACKUP & RESTORE
// ========================================

/**
 * Client timeout for backup validation and restore.
 *
 * The server budgets 120 s for these routes and answers 408 when it runs out;
 * the client waits longer so it receives that answer instead of racing it.
 */
export const ADMIN_RESTORE_TIMEOUT_MS = 150_000;

/**
 * Create and download a database backup (admin only)
 *
 * This returns a Blob for file download.
 */
export async function createBackup(options?: BackupOptions): Promise<Blob> {
  return apiClient.fetchBlob('/admin/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options || {}),
  });
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
  return apiClient.post<ValidationResult>(
    '/admin/backup/validate',
    { backup },
    { timeoutMs: ADMIN_RESTORE_TIMEOUT_MS }
  );
}

/**
 * Restore database from backup (admin only)
 *
 * WARNING: This will DELETE ALL existing data!
 */
export async function restoreBackup(backup: SanctuaryBackup): Promise<RestoreResult> {
  return apiClient.post<RestoreResult>(
    '/admin/restore',
    { backup, confirmationCode: 'CONFIRM_RESTORE' },
    { timeoutMs: ADMIN_RESTORE_TIMEOUT_MS }
  );
}

// ========================================
// AUDIT LOGS
// ========================================

/**
 * Get audit logs with optional filters (admin only)
 */
export async function getAuditLogs(query?: AuditLogQuery): Promise<AuditLogResult> {
  if (!query) return apiClient.get<AuditLogResult>('/admin/audit-logs');

  return apiClient.get<AuditLogResult>('/admin/audit-logs', {
    userId: query.userId || undefined,
    username: query.username || undefined,
    action: query.action || undefined,
    category: query.category || undefined,
    success: query.success,
    startDate: query.startDate || undefined,
    endDate: query.endDate || undefined,
    limit: query.limit || undefined,
    offset: query.offset || undefined,
  });
}

/**
 * Get audit log statistics (admin only)
 */
export async function getAuditLogStats(days?: number): Promise<AuditLogStats> {
  return apiClient.get<AuditLogStats>(
    '/admin/audit-logs/stats',
    days ? { days } : undefined
  );
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
