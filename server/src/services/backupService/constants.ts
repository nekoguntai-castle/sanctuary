/**
 * Backup Service Constants
 *
 * Table ordering, migration registry, and configuration constants.
 */

import type { BackupMigration } from './types';

// Current backup format version
export const BACKUP_FORMAT_VERSION = '1.0.0';

/**
 * Tables in dependency order for export/import.
 * Tables with no foreign keys come first, then tables that depend on them.
 */
export const TABLE_ORDER = [
  // Independent tables (no foreign keys)
  'hardwareDeviceModel',  // Prisma model name
  'systemSetting',
  'nodeConfig',
  'user',
  'mcpApiKey',       // FK: userId
  'group',

  // First-level dependencies
  'groupMember',     // FK: userId, groupId
  'device',          // FK: userId, modelId
  'wallet',          // FK: groupId
  'pushDevice',      // FK: userId
  'electrumServer',  // FK: nodeConfigId

  // Second-level dependencies
  'walletUser',      // FK: walletId, userId
  'walletDevice',    // FK: walletId, deviceId
  'address',         // FK: walletId
  'label',           // FK: walletId
  'walletAgent',     // FK: userId, fundingWalletId, operationalWalletId, signerDeviceId
  'draftTransaction', // FK: walletId, userId
  'consoleSession',  // FK: userId

  // Third-level dependencies
  'agentApiKey',          // FK: agentId
  'agentFundingOverride', // FK: agentId
  'agentAlert',           // FK: agentId
  'agentFundingAttempt',  // FK: agentId
  'consolePromptHistory', // FK: userId, sessionId
  'consoleTurn',          // FK: sessionId
  'transaction',     // FK: walletId, userId, addressId
  'uTXO',            // FK: walletId

  // Fourth-level dependencies
  'consoleToolTrace', // FK: turnId
  'transactionInput',  // FK: transactionId
  'transactionOutput', // FK: transactionId
  'transactionLabel',  // FK: transactionId, labelId
  'addressLabel',      // FK: addressId, labelId
  'draftUtxoLock',     // FK: draftId, utxoId

  // Independent tables (no FK) - placed last for logical grouping
  'auditLog',         // No FK (userId stored as string for history)
] as const;

// Optional cache tables (excluded by default)
export const CACHE_TABLES = ['priceData', 'feeEstimate'] as const;

const BASELINE_RESTORE_SCHEMA_VERSION = 1;

/**
 * Minimum backup schema version that must contain each table for a destructive
 * restore. Backups from older schemas may legitimately predate newer tables,
 * but a current-schema backup that omits one of its known tables is partial and
 * must not be allowed to wipe live data.
 */
export const RESTORE_TABLE_MIN_SCHEMA_VERSION = {
  hardwareDeviceModel: BASELINE_RESTORE_SCHEMA_VERSION,
  systemSetting: BASELINE_RESTORE_SCHEMA_VERSION,
  nodeConfig: BASELINE_RESTORE_SCHEMA_VERSION,
  user: BASELINE_RESTORE_SCHEMA_VERSION,
  mcpApiKey: 47,
  group: BASELINE_RESTORE_SCHEMA_VERSION,
  groupMember: BASELINE_RESTORE_SCHEMA_VERSION,
  device: BASELINE_RESTORE_SCHEMA_VERSION,
  wallet: BASELINE_RESTORE_SCHEMA_VERSION,
  pushDevice: BASELINE_RESTORE_SCHEMA_VERSION,
  electrumServer: 21,
  walletUser: BASELINE_RESTORE_SCHEMA_VERSION,
  walletDevice: BASELINE_RESTORE_SCHEMA_VERSION,
  address: BASELINE_RESTORE_SCHEMA_VERSION,
  label: BASELINE_RESTORE_SCHEMA_VERSION,
  walletAgent: 48,
  draftTransaction: BASELINE_RESTORE_SCHEMA_VERSION,
  consoleSession: 53,
  agentApiKey: 48,
  agentFundingOverride: 52,
  agentAlert: 51,
  agentFundingAttempt: 50,
  consolePromptHistory: 53,
  consoleTurn: 53,
  transaction: BASELINE_RESTORE_SCHEMA_VERSION,
  uTXO: BASELINE_RESTORE_SCHEMA_VERSION,
  consoleToolTrace: 53,
  transactionInput: 27,
  transactionOutput: 27,
  transactionLabel: BASELINE_RESTORE_SCHEMA_VERSION,
  addressLabel: BASELINE_RESTORE_SCHEMA_VERSION,
  draftUtxoLock: 29,
  auditLog: BASELINE_RESTORE_SCHEMA_VERSION,
} satisfies Record<(typeof TABLE_ORDER)[number], number>;

export function getRequiredRestoreTables(
  schemaVersion: number,
  includesCache: boolean
): string[] {
  const requiredTables = TABLE_ORDER.filter(
    (table) => schemaVersion >= RESTORE_TABLE_MIN_SCHEMA_VERSION[table]
  );

  return includesCache
    ? [...requiredTables, ...CACHE_TABLES]
    : requiredTables;
}

// Tables that can grow large and should use cursor-based pagination for export
// to avoid loading all rows into a single Prisma response buffer at once
export const LARGE_TABLES = new Set([
  'transaction', 'uTXO', 'transactionInput', 'transactionOutput',
  'address', 'auditLog', 'addressLabel', 'transactionLabel',
  'agentFundingAttempt', 'agentAlert', 'consolePromptHistory', 'consoleTurn',
  'consoleToolTrace',
]);

// Number of rows to fetch per cursor page during backup export
export const BACKUP_PAGE_SIZE = 1000;

/**
 * Migration registry for forward compatibility.
 * Add migrations here when schema changes.
 *
 * Example migration:
 * {
 *   fromVersion: 1,
 *   toVersion: 2,
 *   migrate: (backup) => {
 *     // Add new field with default value
 *     backup.data.user = backup.data.user.map(u => ({
 *       ...u,
 *       newField: 'default'
 *     }));
 *     return backup;
 *   }
 * }
 */
export const MIGRATIONS: BackupMigration[] = [
  // Baseline migration marker for legacy backups created before schema versioning stabilized.
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: (backup) => backup,
  },
];
