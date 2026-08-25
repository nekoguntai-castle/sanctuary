/**
 * Backup Restore
 *
 * Handles restoring database from backup with transactional safety,
 * encrypted field handling, and schema migration.
 */

import prisma, { type PrismaTxClient } from '../../models/prisma';
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
  IMMUTABLE_EVIDENCE_TABLES,
  getRestoreTables,
} from './constants';
import {
  validateBackupForRestore,
  validateDescriptorPoliciesForRestore,
} from './validation';
import { deserializeRecordForTable } from './restoreDeserialization';
import {
  processAgentApiKeyRecords,
  processMcpApiKeyRecords,
  processNodeConfigRecords,
  processSubscriptionCheckpointCoverageRecords,
  processSystemSettingRecords,
  processUserRecords,
  processWalletSyncIntentRecords,
  processWebhookDeliveryRecords,
  processWebhookEndpointRecords,
} from './restoreTransforms';
import type { SanctuaryBackup, RestoreResult } from './types';
import type { BackupRecord } from './types';
import { serializeRecord } from './serialization';
import { featureFlagRepository } from '../../repositories/featureFlagRepository';
import { featureFlagService } from '../featureFlagService';
import type { FeatureRuntimeState } from '../../repositories/featureFlagRepository';
import {
  OPERATIONAL_SYSTEM_SETTING_PREFIX,
  WALLET_SYNC_ACTIVATION_KEY,
} from '../../repositories/operationalSystemSettings';
import {
  assertCurrentBinarySupportsWalletSyncActivation,
  parseWalletSyncActivation,
} from '../../repositories/walletSyncActivationPolicyRepository';
import { acquireWalletSyncRetirementLock } from '../../repositories/walletSyncRetirementLock';
import type { Prisma } from '../../generated/prisma/client';

const log = createLogger('BACKUP:SVC');
const RESTORE_ACCESS_CACHE_CLEAR_TIMEOUT_MS = 5_000;

async function readOperationalSettings(
  tx: PrismaTxClient,
): Promise<Prisma.SystemSettingCreateManyInput[]> {
  const settings = await tx.systemSetting.findMany({
    where: { key: { startsWith: OPERATIONAL_SYSTEM_SETTING_PREFIX } },
  });
  const activation = settings.find(({ key }) => key === WALLET_SYNC_ACTIVATION_KEY);
  if (activation) {
    if (typeof activation.value !== 'string') {
      throw new Error('Invalid durable wallet-sync activation policy');
    }
    const parsed = parseWalletSyncActivation(activation.value);
    assertCurrentBinarySupportsWalletSyncActivation(parsed);
  }
  return settings;
}

async function preserveOperationalSettings(
  tx: PrismaTxClient,
  settings: Prisma.SystemSettingCreateManyInput[],
): Promise<void> {
  if (settings.length === 0) return;
  await tx.systemSetting.createMany({ data: settings });
}

function processRestoreRecords(
  table: string,
  records: BackupRecord[],
  warnings: string[],
  currentSessionVersions: ReadonlyMap<string, number>,
  currentOperationalKeys: ReadonlySet<string>,
): BackupRecord[] {
  let processed = records.map(record => deserializeRecordForTable(table, record));
  if (table === 'nodeConfig') processed = processNodeConfigRecords(processed, warnings);
  if (table === 'systemSetting') {
    processed = processSystemSettingRecords(
      processed,
      warnings,
      currentOperationalKeys,
    );
  }
  if (table === 'wallet') processed = processWalletSyncIntentRecords(processed);
  if (table === 'addressSubscriptionCheckpoint') {
    processed = processSubscriptionCheckpointCoverageRecords(processed);
  }
  if (table === 'user') {
    processed = processUserRecords(processed, warnings, currentSessionVersions);
  }
  if (table === 'mcpApiKey') processed = processMcpApiKeyRecords(processed, warnings);
  if (table === 'agentApiKey') processed = processAgentApiKeyRecords(processed, warnings);
  if (table === 'webhookEndpoint') {
    processed = processWebhookEndpointRecords(processed, warnings);
  }
  if (table === 'webhookDelivery') processed = processWebhookDeliveryRecords(processed);
  return processed;
}

/**
 * Restore database from backup
 * WARNING: This replaces ordinary application data. Immutable remediation
 * evidence is preserved and merged only after exact-record comparison.
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
      accessCacheReconciled: false,
      featureRuntimeReconciled: false,
      error: `Backup validation failed: ${validation.issues.join('; ')}`,
    };
  }
  // Preserve restore's established warning contract: generic preview warnings
  // (for example, optional legacy tables) are not emitted during a successful
  // restore, but funds-safety policy quarantine warnings must be surfaced.
  warnings.push(...validateDescriptorPoliciesForRestore(backup.data).warnings);

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
    const migratedPolicyValidation = validateDescriptorPoliciesForRestore(
      migratedBackup.data,
    );
    warnings.push(...migratedPolicyValidation.warnings);
    if (migratedPolicyValidation.issues.length > 0) {
      return {
        success: false,
        tablesRestored: 0,
        recordsRestored: 0,
        warnings,
        committed: false,
        cacheInvalidated: false,
        accessCacheReconciled: false,
        featureRuntimeReconciled: false,
        error: `Restore preflight failed: ${migratedPolicyValidation.issues.join('; ')}`,
      };
    }
  }

  // Get list of tables that actually exist in the database
  const existingTables = await getExistingTables();
  const existingTableSet = new Set(existingTables);
  const immutableEvidenceTables = new Set<string>(IMMUTABLE_EVIDENCE_TABLES);
  const tablesToDelete = [...TABLE_ORDER, ...CACHE_TABLES, ...EPHEMERAL_TABLES]
    .filter(table => !immutableEvidenceTables.has(table));
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
      accessCacheReconciled: false,
      featureRuntimeReconciled: false,
      error: `Restore preflight failed: missing live database tables: ${missingTables.join(', ')}`,
    };
  }

  let restoredRuntimeState: FeatureRuntimeState;
  try {
    restoredRuntimeState = await prisma.$transaction(async (tx) => {
      // Preserve irreversible wallet-sync floors against a cutover that races
      // restore's initial operational-setting snapshot.
      await acquireWalletSyncRetirementLock(tx);
      const currentSessionVersions = await getCurrentSessionVersions(tx);
      const currentFeatureGeneration = await featureFlagRepository.readGeneration(tx);
      const currentOperationalSettings = await readOperationalSettings(tx);
      const currentOperationalKeys = new Set(
        currentOperationalSettings.map(({ key }) => key),
      );
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
          const processedRecords = processRestoreRecords(
            table,
            records,
            warnings,
            currentSessionVersions,
            currentOperationalKeys,
          );

          await persistRestoreRecords(
            tx,
            table,
            processedRecords,
            immutableEvidenceTables,
          );

          tablesRestored++;
          recordsRestored += processedRecords.length;
          log.debug(`[BACKUP] Restored ${processedRecords.length} records to ${table}`);
        } catch (error) {
          const errorMsg = `Failed to restore table ${table}: ${getErrorMessage(error)}`;
          log.error('[BACKUP] ' + errorMsg);
          throw new Error(errorMsg);
        }
      }
      // Live operational settings always win. Strictly validated irreversible
      // wallet-sync floors may seed an empty recovery database from backup.
      await preserveOperationalSettings(tx, currentOperationalSettings);
      const generation = await featureFlagRepository.advanceGeneration(
        tx,
        currentFeatureGeneration,
      );
      const state = await featureFlagRepository.loadRuntimeStateInTransaction(tx);
      return { ...state, generation };
    }, {
      isolationLevel: 'Serializable',
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
      accessCacheReconciled: false,
      featureRuntimeReconciled: false,
      error: getErrorMessage(error),
    };
  }

  const [cacheError, featureRuntimeError] = await Promise.all([
    clearAccessCacheAfterCommittedRestore(),
    featureFlagService.reconcileAfterRestore(restoredRuntimeState).then(
      () => null,
      (error) => `Restore committed but feature runtime reconciliation failed: ${getErrorMessage(error)}`,
    ),
  ]);
  if (cacheError || featureRuntimeError) {
    return {
      success: false,
      tablesRestored,
      recordsRestored,
      warnings,
      committed: true,
      cacheInvalidated: !cacheError,
      accessCacheReconciled: !cacheError,
      featureRuntimeReconciled: !featureRuntimeError,
      error: [cacheError, featureRuntimeError].filter(Boolean).join('; '),
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
    accessCacheReconciled: true,
    featureRuntimeReconciled: true,
  };
}

type ImmutableEvidenceClient = {
  findUnique(args: { where: { id: string } }): Promise<BackupRecord | null>;
  create(args: { data: BackupRecord }): Promise<BackupRecord>;
};

type BulkRestoreClient = {
  createMany(args: { data: BackupRecord[]; skipDuplicates: false }): Promise<unknown>;
};

type SubscriptionCheckpointRestoreClient = BulkRestoreClient & {
  deleteMany(args: {
    where: { addressId: { in: string[] } };
  }): Promise<unknown>;
};

async function replaceTriggerCreatedSubscriptionCheckpoints(
  tx: unknown,
  records: BackupRecord[],
): Promise<void> {
  // Backup graph validation has already proved every checkpoint address ID.
  const addressIds = records.map((record) => record.addressId) as string[];
  const client = (tx as Record<string, SubscriptionCheckpointRestoreClient>)
    .addressSubscriptionCheckpoint;
  await client.deleteMany({ where: { addressId: { in: addressIds } } });
  await client.createMany({ data: records, skipDuplicates: false });
}

async function persistRestoreRecords(
  tx: unknown,
  table: string,
  records: BackupRecord[],
  immutableEvidenceTables: ReadonlySet<string>,
): Promise<void> {
  if (table === 'addressSubscriptionCheckpoint') {
    await replaceTriggerCreatedSubscriptionCheckpoints(tx, records);
    return;
  }
  if (immutableEvidenceTables.has(table)) {
    await mergeImmutableEvidenceRecords(tx, table, records);
    return;
  }
  const client = (tx as Record<string, BulkRestoreClient>)[table];
  await client.createMany({ data: records, skipDuplicates: false });
}

function canonicalJson(value: unknown): string {
  /* v8 ignore next -- serializeRecord removes undefined object properties before this comparator. */
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as BackupRecord;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function exactEvidenceRecord(record: BackupRecord): string {
  return canonicalJson(serializeRecord(record));
}

async function mergeImmutableEvidenceRecords(
  tx: unknown,
  table: string,
  records: BackupRecord[],
): Promise<void> {
  const client = (tx as unknown as Record<string, ImmutableEvidenceClient>)[table];
  for (const record of records) {
    /* v8 ignore next 2 -- pre-transaction remediation evidence validation rejects absent IDs;
     * this remains a defense-in-depth guard if another caller is introduced. */
    if (typeof record.id !== 'string' || record.id.length === 0) {
      throw new Error(`Immutable evidence record in ${table} has no exact ID`);
    }
    const existing = await client.findUnique({ where: { id: record.id } });
    if (existing) {
      if (exactEvidenceRecord(existing) !== exactEvidenceRecord(record)) {
        throw new Error(`Immutable evidence mismatch in ${table} for ID ${record.id}`);
      }
      continue;
    }
    await client.create({ data: record });
  }
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
