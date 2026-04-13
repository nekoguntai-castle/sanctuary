/**
 * Admin Backup & Restore API
 *
 * Database backup, restore, encryption keys, and audit log API calls (admin only)
 */

import apiClient, { API_BASE_URL } from '../client';

// CSRF cookie + header names, kept in sync with src/api/client.ts.
const CSRF_COOKIE_NAME = 'sanctuary_csrf';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

function readCsrfCookieValue(): string | null {
  // Browser-only: document is always defined.
  const raw = document.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [rawName, ...rest] = part.split('=');
    if (rawName?.trim() === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join('=')).trim();
    }
  }
  return null;
}
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
 * Create and download a database backup (admin only)
 *
 * This returns a Blob for file download.
 */
export async function createBackup(options?: BackupOptions): Promise<Blob> {
  // ADR 0001 Phase 4: authenticate via HttpOnly cookies (credentials:
  // 'include') + double-submit CSRF header instead of a JS-readable Bearer.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const csrf = readCsrfCookieValue();
  if (csrf) headers[CSRF_HEADER_NAME] = csrf;

  const response = await fetch(`${API_BASE_URL}/admin/backup`, {
    method: 'POST',
    credentials: 'include',
    headers,
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
