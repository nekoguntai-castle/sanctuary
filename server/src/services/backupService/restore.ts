/**
 * Backup Restore
 *
 * Handles restoring database from backup with transactional safety,
 * encrypted field handling, and schema migration.
 */

import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { withTimeout } from '../../utils/async';
import { clearAccessCacheStrict } from '../../infrastructure/accessCache';
import { migrationService } from '../migrationService';
import { camelToSnakeCase } from './serialization';
import { migrateBackup } from './migration';
import {
  TABLE_ORDER,
  CACHE_TABLES,
  EPHEMERAL_TABLES,
  getRestoreTables,
} from './constants';
import { validateBackupForRestore } from './validation';
import { deserializeRecordForTable } from './restoreDeserialization';
import {
  processAgentApiKeyRecords,
  processMcpApiKeyRecords,
  processNodeConfigRecords,
  processSystemSettingRecords,
  processUserRecords,
  processWebhookDeliveryRecords,
  processWebhookEndpointRecords,
} from './restoreTransforms';
import type { SanctuaryBackup, RestoreResult } from './types';

const log = createLogger('BACKUP:SVC');
const RESTORE_ACCESS_CACHE_CLEAR_TIMEOUT_MS = 5_000;

/**
 * Restore database from backup
 * WARNING: This will DELETE ALL existing data
 */
export async function restoreFromBackup(backup: SanctuaryBackup): Promise<RestoreResult> {
  const warnings: string[] = [];
  let tablesRestored = 0;
  let recordsRestored = 0;

  const validation = await validateBackupForRestore(backup);
  if (!validation.valid) {
    return {
      success: false,
      tablesRestored: 0,
      recordsRestored: 0,
      warnings: validation.warnings,
      committed: false,
      cacheInvalidated: false,
      error: `Backup validation failed: ${validation.issues.join('; ')}`,
    };
  }

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
  const tablesToDelete = [...TABLE_ORDER, ...CACHE_TABLES, ...EPHEMERAL_TABLES];
  const tablesToRestore = getRestoreTables(migratedBackup.meta);
  const missingTables = getMissingLiveTables(
    [...new Set([...tablesToDelete, ...tablesToRestore])],
    existingTableSet
  );
  if (missingTables.length > 0) {
    return {
      success: false,
      tablesRestored: 0,
      recordsRestored: 0,
      warnings,
      committed: false,
      cacheInvalidated: false,
      error: `Restore preflight failed: missing live database tables: ${missingTables.join(', ')}`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const currentSessionVersions = await getCurrentSessionVersions(tx);
      // Delete all tables in REVERSE order (to handle foreign key constraints)
      log.debug('[BACKUP] Deleting existing data in reverse order');
      for (const table of [...tablesToDelete].reverse()) {
        try {
          // @ts-expect-error - Dynamic Prisma table access; table name validated against TABLE_ORDER constant
          await tx[table].deleteMany({});
          log.debug(`[BACKUP] Deleted all records from ${table}`);
        } catch (error) {
          const errorMsg = `Failed to delete table ${table}: ${getErrorMessage(error)}`;
          log.error('[BACKUP] ' + errorMsg);
          throw new Error(errorMsg);
        }
      }

      // Insert data in FORWARD order (respects foreign key dependencies)
      log.debug('[BACKUP] Inserting backup data in forward order');
      for (const table of tablesToRestore) {
        const records = migratedBackup.data[table];
        if (!records || !Array.isArray(records) || records.length === 0) {
          continue;
        }

        try {
          // Handle DateTime fields (they come as strings from JSON)
          let processedRecords = records.map((record) => deserializeRecordForTable(table, record));

          // Special handling for nodeConfig - check if encrypted passwords can be decrypted
          if (table === 'nodeConfig') {
            processedRecords = processNodeConfigRecords(processedRecords, warnings);
          }

          // Special handling for system settings - restored external AI provider credentials fail closed.
          if (table === 'systemSetting') {
            processedRecords = processSystemSettingRecords(processedRecords, warnings);
          }

          // Special handling for user - check if encrypted 2FA secrets can be decrypted
          if (table === 'user') {
            processedRecords = processUserRecords(
              processedRecords,
              warnings,
              currentSessionVersions
            );
          }

          // Restored MCP bearer-token hashes are external-access credentials.
          // Keep metadata for audit/admin review, but force every restored key closed.
          if (table === 'mcpApiKey') {
            processedRecords = processMcpApiKeyRecords(processedRecords, warnings);
          }

          if (table === 'agentApiKey') {
            processedRecords = processAgentApiKeyRecords(processedRecords, warnings);
          }

          if (table === 'webhookEndpoint') {
            processedRecords = processWebhookEndpointRecords(processedRecords, warnings);
          }

          if (table === 'webhookDelivery') {
            processedRecords = processWebhookDeliveryRecords(processedRecords);
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
      maxWait: 10_000,
      timeout: 120000, // 2 minute timeout for large restores
    });

  } catch (error) {
    log.error('[BACKUP] Restore failed, transaction rolled back', { error: getErrorMessage(error) });
    return {
      success: false,
      tablesRestored: 0,
      recordsRestored: 0,
      warnings,
      committed: false,
      cacheInvalidated: false,
      error: getErrorMessage(error),
    };
  }

  const cacheError = await clearAccessCacheAfterCommittedRestore();
  if (cacheError) {
    return {
      success: false,
      tablesRestored,
      recordsRestored,
      warnings,
      committed: true,
      cacheInvalidated: false,
      error: cacheError,
    };
  }

  log.info('[BACKUP] Restore completed', { tablesRestored, recordsRestored });

  return {
    success: true,
    tablesRestored,
    recordsRestored,
    warnings,
    committed: true,
    cacheInvalidated: true,
  };
}

async function clearAccessCacheAfterCommittedRestore(): Promise<string | null> {
  try {
    await withTimeout(
      clearAccessCacheStrict(),
      RESTORE_ACCESS_CACHE_CLEAR_TIMEOUT_MS,
      `Access cache invalidation timed out after ${RESTORE_ACCESS_CACHE_CLEAR_TIMEOUT_MS}ms`,
      (lateError) => {
        log.warn('[BACKUP] Access cache invalidation failed after restore timeout', {
          error: getErrorMessage(lateError),
        });
      }
    );
    return null;
  } catch (error) {
    const errorMessage = `Restore committed but access cache invalidation failed: ${getErrorMessage(error)}`;
    log.error('[BACKUP] ' + errorMessage);
    return errorMessage;
  }
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

function getMissingLiveTables(tables: string[], existingTableSet: ReadonlySet<string>): string[] {
  return tables.filter(table => !existingTableSet.has(camelToSnakeCase(table)));
}

async function getCurrentSessionVersions(
  tx: Pick<typeof prisma, 'user'>
): Promise<Map<string, number>> {
  const users = await tx.user.findMany({
    select: {
      id: true,
      sessionVersion: true,
    },
  });
  return new Map(users.map(user => [user.id, user.sessionVersion]));
}
