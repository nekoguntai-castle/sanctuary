/**
 * Backup Service Module
 *
 * Barrel file re-exporting the public API from all sub-modules.
 * External consumers should import from this index.
 */

// Types
export type {
  BackupRecord,
  BackupMeta,
  SanctuaryBackup,
  BackupOptions,
  ValidationResult,
  RestoreResult,
  BackupMigration,
} from './types';

// BackupService class
export { BackupService } from './backupService';

// Singleton instance
import { BackupService } from './backupService';
export const backupService = new BackupService();
