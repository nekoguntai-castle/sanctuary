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
