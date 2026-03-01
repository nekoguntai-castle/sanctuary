/**
 * Backup Service Types
 *
 * Shared interfaces and type definitions for the backup service module.
 */

/** Generic record shape for backup serialization (Prisma rows, JSON objects) */
export type BackupRecord = Record<string, unknown>;

/**
 * Backup metadata
 */
export interface BackupMeta {
  version: string;           // Backup format version
  appVersion: string;        // Sanctuary app version
  schemaVersion: number;     // Database schema version
  createdAt: string;         // ISO timestamp
  createdBy: string;         // Admin username
  description?: string;      // Optional description
  includesCache: boolean;    // Whether cache tables are included
  recordCounts: Record<string, number>; // Per-table record counts
}

/**
 * Complete backup structure
 */
export interface SanctuaryBackup {
  meta: BackupMeta;
  data: Record<string, BackupRecord[]>;
}

/**
 * Backup creation options
 */
export interface BackupOptions {
  includeCache?: boolean;
  description?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  issues: string[];      // Critical issues (prevent restore)
  warnings: string[];    // Non-critical warnings
  info: {
    createdAt: string;
    appVersion: string;
    schemaVersion: number;
    totalRecords: number;
    tables: string[];
  };
}

/**
 * Restore result
 */
export interface RestoreResult {
  success: boolean;
  tablesRestored: number;
  recordsRestored: number;
  warnings: string[];
  error?: string;
}

/**
 * Backup migration function
 */
export interface BackupMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (backup: SanctuaryBackup) => SanctuaryBackup;
}
