/**
 * Backup Validation
 *
 * Validates backup structure, schema version, and referential integrity
 * before restore.
 */

import { migrationService } from '../migrationService';
import { TABLE_ORDER } from './constants';
import type { BackupRecord, BackupMeta, ValidationResult } from './types';

/**
 * Validate a backup file before restore
 */
export async function validateBackup(backup: unknown): Promise<ValidationResult> {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Get current schema version for comparison
  const currentSchemaVersion = await migrationService.getSchemaVersion();

  // Structure validation
  if (backup === null || backup === undefined || typeof backup !== 'object') {
    issues.push('Invalid backup format: not an object');
    return {
      valid: false,
      issues,
      warnings,
      info: { createdAt: '', appVersion: '', schemaVersion: 0, totalRecords: 0, tables: [] },
    };
  }

  const backupObj = backup as BackupRecord;

  if (!backupObj.meta) {
    issues.push('Missing meta section');
  }

  if (!backupObj.data) {
    issues.push('Missing data section');
  }

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      warnings,
      info: { createdAt: '', appVersion: '', schemaVersion: 0, totalRecords: 0, tables: [] },
    };
  }

  const meta = backupObj.meta as BackupMeta;

  // Version validation
  if (!meta.version) {
    issues.push('Missing backup format version');
  }

  if (!meta.appVersion) {
    warnings.push('Missing app version');
  }

  if (meta.schemaVersion === undefined) {
    issues.push('Missing schema version');
  } else if (meta.schemaVersion > currentSchemaVersion) {
    // Allow restoring from slightly newer schema versions with a warning
    // This can happen when migrations are consolidated during development
    const versionDiff = meta.schemaVersion - currentSchemaVersion;
    if (versionDiff <= 10) {
      warnings.push(`Backup schema version (${meta.schemaVersion}) is newer than current (${currentSchemaVersion}). Proceeding with caution - some fields may be ignored.`);
    } else {
      issues.push(`Backup schema version (${meta.schemaVersion}) is too far ahead of current (${currentSchemaVersion}). Cannot restore from future version.`);
    }
  }

  // Data validation
  const data = backupObj.data as Record<string, BackupRecord[]>;
  const tables = Object.keys(data);

  // Check for required tables
  for (const table of TABLE_ORDER) {
    if (!data[table]) {
      warnings.push(`Missing table: ${table}`);
    } else if (!Array.isArray(data[table])) {
      issues.push(`Table ${table} is not an array`);
    }
  }

  // Users validation
  if (data.user && Array.isArray(data.user)) {
    if (data.user.length === 0) {
      issues.push('Backup must contain at least one user');
    } else {
      const hasAdmin = data.user.some((u: BackupRecord) => u.isAdmin === true);
      if (!hasAdmin) {
        issues.push('Backup must contain at least one admin user');
      }
    }
  }

  // Referential integrity checks
  if (data.user && data.device) {
    const userIds = new Set(data.user.map((u: BackupRecord) => u.id));
    for (const device of data.device) {
      if (!userIds.has(device.userId)) {
        issues.push(`Device ${device.id} references non-existent user ${device.userId}`);
      }
    }
  }

  if (data.wallet && data.walletUser && data.user) {
    const walletIds = new Set(data.wallet.map((w: BackupRecord) => w.id));
    const userIds = new Set(data.user.map((u: BackupRecord) => u.id));
    for (const wu of data.walletUser) {
      if (!walletIds.has(wu.walletId)) {
        issues.push(`WalletUser references non-existent wallet ${wu.walletId}`);
      }
      if (!userIds.has(wu.userId)) {
        issues.push(`WalletUser references non-existent user ${wu.userId}`);
      }
    }
  }

  // Calculate total records
  let totalRecords = 0;
  for (const table of tables) {
    if (Array.isArray(data[table])) {
      totalRecords += data[table].length;
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    info: {
      createdAt: meta.createdAt || '',
      appVersion: meta.appVersion || '',
      schemaVersion: meta.schemaVersion || 0,
      totalRecords,
      tables,
    },
  };
}
