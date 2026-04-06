/**
 * Backup Restore
 *
 * Handles restoring database from backup with transactional safety,
 * encrypted field handling, and schema migration.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { migrationService } from '../migrationService';
import { isEncrypted, decrypt } from '../../utils/encryption';
import { processRecord, camelToSnakeCase } from './serialization';
import { migrateBackup } from './migration';
import { TABLE_ORDER, CACHE_TABLES } from './constants';
import type { BackupRecord, SanctuaryBackup, RestoreResult } from './types';

const log = createLogger('BACKUP:SVC');

/**
 * Restore database from backup
 * WARNING: This will DELETE ALL existing data
 */
export async function restoreFromBackup(backup: SanctuaryBackup): Promise<RestoreResult> {
  const warnings: string[] = [];
  let tablesRestored = 0;
  let recordsRestored = 0;

  // Get current schema version
  const currentSchemaVersion = await migrationService.getSchemaVersion();

  log.info('[BACKUP] Starting restore', {
    backupDate: backup.meta.createdAt,
    schemaVersion: backup.meta.schemaVersion,
    currentSchemaVersion,
  });

  // Apply migrations if needed
  let migratedBackup = backup;
  if (backup.meta.schemaVersion < currentSchemaVersion) {
    log.info('[BACKUP] Migrating backup from schema version', {
      from: backup.meta.schemaVersion,
      to: currentSchemaVersion,
    });
    migratedBackup = migrateBackup(backup, currentSchemaVersion);
  }

  // Get list of tables that actually exist in the database
  const existingTables = await getExistingTables();
  const existingTableSet = new Set(existingTables);

  try {
    // Use Prisma transaction for atomicity
    await prisma.$transaction(async (tx) => {
      // Delete all tables in REVERSE order (to handle foreign key constraints)
      const allTables = migratedBackup.meta.includesCache
        ? [...TABLE_ORDER, ...CACHE_TABLES]
        : [...TABLE_ORDER];

      log.debug('[BACKUP] Deleting existing data in reverse order');
      for (const table of [...allTables].reverse()) {
        // Skip tables that don't exist in the current database
        const snakeCase = camelToSnakeCase(table);
        if (!existingTableSet.has(snakeCase)) {
          log.debug(`[BACKUP] Skipping delete from ${table} (table does not exist)`);
          continue;
        }

        try {
          // @ts-expect-error - Dynamic Prisma table access; table name validated against TABLE_ORDER constant
          await tx[table].deleteMany({});
          log.debug(`[BACKUP] Deleted all records from ${table}`);
        } catch (error) {
          log.warn(`[BACKUP] Failed to delete from ${table}`, { error: getErrorMessage(error) });
        }
      }

      // Insert data in FORWARD order (respects foreign key dependencies)
      log.debug('[BACKUP] Inserting backup data in forward order');
      for (const table of allTables) {
        const records = migratedBackup.data[table];
        if (!records || !Array.isArray(records) || records.length === 0) {
          continue;
        }

        // Skip tables that don't exist in the current database
        const snakeCase = camelToSnakeCase(table);
        if (!existingTableSet.has(snakeCase)) {
          log.warn(`[BACKUP] Skipping restore of ${table} (${records.length} records) - table does not exist`);
          warnings.push(`Table ${table} was skipped during restore (not in current database schema)`);
          continue;
        }

        try {
          // Handle DateTime fields (they come as strings from JSON)
          let processedRecords = records.map((record) => processRecord(record));

          // Special handling for nodeConfig - check if encrypted passwords can be decrypted
          if (table === 'nodeConfig') {
            processedRecords = processNodeConfigRecords(processedRecords, warnings);
          }

          // Special handling for user - check if encrypted 2FA secrets can be decrypted
          if (table === 'user') {
            processedRecords = processUserRecords(processedRecords, warnings);
          }

          // Use createMany for bulk insert
          // @ts-expect-error - Dynamic Prisma table access; table name validated against TABLE_ORDER constant
          await tx[table].createMany({
            data: processedRecords,
            skipDuplicates: false,
          });

          tablesRestored++;
          recordsRestored += records.length;
          log.debug(`[BACKUP] Restored ${records.length} records to ${table}`);
        } catch (error) {
          const errorMsg = `Failed to restore table ${table}: ${getErrorMessage(error)}`;
          log.error('[BACKUP] ' + errorMsg);
          throw new Error(errorMsg);
        }
      }
    }, {
      timeout: 120000, // 2 minute timeout for large restores
    });

    log.info('[BACKUP] Restore completed', { tablesRestored, recordsRestored });

    return {
      success: true,
      tablesRestored,
      recordsRestored,
      warnings,
    };
  } catch (error) {
    log.error('[BACKUP] Restore failed, transaction rolled back', { error: getErrorMessage(error) });
    return {
      success: false,
      tablesRestored: 0,
      recordsRestored: 0,
      warnings,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Process nodeConfig records - check if encrypted passwords can be decrypted
 */
function processNodeConfigRecords(records: BackupRecord[], warnings: string[]): BackupRecord[] {
  return records.map((record) => {
    const password = record.password;
    if (typeof password === 'string' && isEncrypted(password)) {
      try {
        // Try to decrypt with current ENCRYPTION_KEY
        decrypt(password);
        // If successful, keep the password
      } catch (error) {
        // Can't decrypt - password was encrypted with different key
        log.warn('[BACKUP] Node config password cannot be decrypted (different ENCRYPTION_KEY)', {
          nodeType: record.type,
        });
        warnings.push(
          `Node configuration password could not be restored (encrypted with different key). Please update your ${record.type || 'node'} password in Settings > Node Configuration.`
        );
        // Clear the password so user knows to re-enter it
        return { ...record, password: null };
      }
    }
    return record;
  });
}

/**
 * Process user records - check if encrypted 2FA secrets can be decrypted
 */
function processUserRecords(records: BackupRecord[], warnings: string[]): BackupRecord[] {
  return records.map((record) => {
    const secret = record.twoFactorSecret;
    if (typeof secret === 'string' && isEncrypted(secret)) {
      try {
        // Try to decrypt with current ENCRYPTION_KEY/ENCRYPTION_SALT
        decrypt(secret);
        // If successful, keep the 2FA secret
      } catch (error) {
        // Can't decrypt - 2FA secret was encrypted with different key/salt
        log.warn('[BACKUP] 2FA secret cannot be decrypted (different ENCRYPTION_KEY/SALT)', {
          username: record.username,
        });
        warnings.push(
          `2FA for user "${record.username}" could not be restored (encrypted with different key). User will need to re-setup 2FA.`
        );
        // Clear 2FA settings so user can re-setup
        return {
          ...record,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: null,
        };
      }
    }
    return record;
  });
}

/**
 * Get list of tables that exist in the database
 */
async function getExistingTables(): Promise<string[]> {
  const result = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename NOT LIKE '_prisma%'
  `;
  return result.map((r) => r.tablename);
}
