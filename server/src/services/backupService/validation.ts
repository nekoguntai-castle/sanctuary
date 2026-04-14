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
    return createValidationResult(false, issues, warnings);
  }

  const backupObj = backup as BackupRecord;

  if (!validateBackupStructure(backupObj, issues)) {
    return createValidationResult(false, issues, warnings);
  }

  const meta = backupObj.meta as BackupMeta;
  const data = backupObj.data as Record<string, BackupRecord[]>;
  const tables = Object.keys(data);

  validateBackupMeta(meta, currentSchemaVersion, issues, warnings);
  validateRequiredTables(data, issues, warnings);
  validateUsers(data, issues);
  validateDeviceReferences(data, issues);
  validateWalletUserReferences(data, issues);

  return createValidationResult(issues.length === 0, issues, warnings, meta, tables, data);
}

const createEmptyInfo = (): ValidationResult['info'] => ({
  createdAt: '',
  appVersion: '',
  schemaVersion: 0,
  totalRecords: 0,
  tables: [],
});

const createValidationResult = (
  valid: boolean,
  issues: string[],
  warnings: string[],
  meta?: BackupMeta,
  tables: string[] = [],
  data?: Record<string, BackupRecord[]>
): ValidationResult => {
  if (!meta || !data) {
    return {
      valid,
      issues,
      warnings,
      info: createEmptyInfo(),
    };
  }

  return {
    valid,
    issues,
    warnings,
    info: {
      createdAt: meta.createdAt || '',
      appVersion: meta.appVersion || '',
      schemaVersion: meta.schemaVersion || 0,
      totalRecords: countTotalRecords(data, tables),
      tables,
    },
  };
};

const validateBackupStructure = (backupObj: BackupRecord, issues: string[]): boolean => {
  if (!backupObj.meta) {
    issues.push('Missing meta section');
  }

  if (!backupObj.data) {
    issues.push('Missing data section');
  }

  return issues.length === 0;
};

const validateBackupMeta = (
  meta: BackupMeta,
  currentSchemaVersion: number,
  issues: string[],
  warnings: string[]
): void => {
  if (!meta.version) {
    issues.push('Missing backup format version');
  }

  if (!meta.appVersion) {
    warnings.push('Missing app version');
  }

  validateSchemaVersion(meta, currentSchemaVersion, issues, warnings);
};

const validateSchemaVersion = (
  meta: BackupMeta,
  currentSchemaVersion: number,
  issues: string[],
  warnings: string[]
): void => {
  if (meta.schemaVersion === undefined) {
    issues.push('Missing schema version');
    return;
  }

  if (meta.schemaVersion <= currentSchemaVersion) {
    return;
  }

  // Slightly newer versions are allowed because migrations can be consolidated during development.
  const versionDiff = meta.schemaVersion - currentSchemaVersion;
  if (versionDiff <= 10) {
    warnings.push(`Backup schema version (${meta.schemaVersion}) is newer than current (${currentSchemaVersion}). Proceeding with caution - some fields may be ignored.`);
    return;
  }

  issues.push(`Backup schema version (${meta.schemaVersion}) is too far ahead of current (${currentSchemaVersion}). Cannot restore from future version.`);
};

const validateRequiredTables = (
  data: Record<string, BackupRecord[]>,
  issues: string[],
  warnings: string[]
): void => {
  for (const table of TABLE_ORDER) {
    if (!data[table]) {
      warnings.push(`Missing table: ${table}`);
    } else if (!Array.isArray(data[table])) {
      issues.push(`Table ${table} is not an array`);
    }
  }
};

const validateUsers = (data: Record<string, BackupRecord[]>, issues: string[]): void => {
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
};

const validateDeviceReferences = (
  data: Record<string, BackupRecord[]>,
  issues: string[]
): void => {
  if (data.user && data.device) {
    const userIds = new Set(data.user.map((u: BackupRecord) => u.id));
    for (const device of data.device) {
      if (!userIds.has(device.userId)) {
        issues.push(`Device ${device.id} references non-existent user ${device.userId}`);
      }
    }
  }
};

const validateWalletUserReferences = (
  data: Record<string, BackupRecord[]>,
  issues: string[]
): void => {
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
};

const countTotalRecords = (data: Record<string, BackupRecord[]>, tables: string[]): number => {
  let totalRecords = 0;
  for (const table of tables) {
    if (Array.isArray(data[table])) {
      totalRecords += data[table].length;
    }
  }

  return totalRecords;
};
