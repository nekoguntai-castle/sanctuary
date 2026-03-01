/**
 * Backup Service
 *
 * Handles database backup and restore operations for Sanctuary.
 * Supports forward compatibility through schema versioning and migrations.
 *
 * Usage:
 *   const backupService = new BackupService();
 *   const backup = await backupService.createBackup('admin', { includeCache: false });
 *   const validation = await backupService.validateBackup(backup);
 *   const result = await backupService.restoreFromBackup(backup);
 *
 * Backup Format Version History:
 *   1.0.0 - Initial backup format
 *
 * SECURITY CONSIDERATIONS FOR BACKUP ENCRYPTION:
 * ================================================
 * Current Status: Backups are exported as unencrypted JSON files.
 *
 * Sensitive Data in Backups:
 *   - User password hashes (bcrypt) - Already hashed, relatively safe
 *   - Node configuration passwords (AES-256-GCM encrypted with ENCRYPTION_KEY)
 *   - 2FA TOTP secrets (AES-256-GCM encrypted with ENCRYPTION_KEY + ENCRYPTION_SALT)
 *   - 2FA backup codes (bcrypt hashed, safe)
 *   - Wallet descriptors and xpubs (sensitive financial data)
 *   - Transaction history and addresses
 *
 * Cross-Instance Restore Behavior:
 *   When restoring to an instance with different ENCRYPTION_KEY or ENCRYPTION_SALT:
 *   - Node passwords: Cleared with warning, user must re-enter
 *   - 2FA secrets: Cleared with warning, user must re-setup 2FA
 *   - All other data: Restored normally
 *
 * Recommendation:
 *   While password hashes and node passwords are already protected, we recommend:
 *
 *   1. IMMEDIATE: Users should store backup files in encrypted storage (e.g.,
 *      encrypted disk, password manager, or encrypted cloud storage).
 *
 *   2. FUTURE ENHANCEMENT: Add optional client-side encryption for backup exports
 *      using a user-provided passphrase. This would encrypt the entire backup
 *      JSON before download using AES-256-GCM with a key derived from the
 *      passphrase via Argon2id or scrypt.
 *
 *   3. DO NOT implement server-side backup encryption with a stored key, as this
 *      provides no real security benefit - if the server is compromised, the
 *      encryption key would also be compromised.
 *
 * The current approach is acceptable because:
 *   - Backups require admin authentication to create
 *   - Sensitive passwords are already encrypted/hashed
 *   - Users are responsible for secure storage of exported files
 *   - The restore process requires explicit confirmation
 */

import { migrationService } from '../migrationService';
import { createBackup } from './creation';
import { validateBackup } from './validation';
import { restoreFromBackup } from './restore';
import { BACKUP_FORMAT_VERSION } from './constants';
import type { SanctuaryBackup, BackupOptions, ValidationResult, RestoreResult } from './types';

/**
 * BackupService class
 */
export class BackupService {
  /**
   * Create a complete database backup
   */
  async createBackup(adminUser: string, options: BackupOptions = {}): Promise<SanctuaryBackup> {
    return createBackup(adminUser, options);
  }

  /**
   * Validate a backup file before restore
   */
  async validateBackup(backup: unknown): Promise<ValidationResult> {
    return validateBackup(backup);
  }

  /**
   * Restore database from backup
   * WARNING: This will DELETE ALL existing data
   */
  async restoreFromBackup(backup: SanctuaryBackup): Promise<RestoreResult> {
    return restoreFromBackup(backup);
  }

  /**
   * Get current schema version from applied migrations
   */
  async getSchemaVersion(): Promise<number> {
    return migrationService.getSchemaVersion();
  }

  /**
   * Get backup format version
   */
  getFormatVersion(): string {
    return BACKUP_FORMAT_VERSION;
  }
}
