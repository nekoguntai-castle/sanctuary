/**
 * Backup Service Constants
 *
 * Table ordering, migration registry, and configuration constants.
 */

import type { BackupMeta, BackupMigration } from './types';

// Current backup format version
export const BACKUP_FORMAT_VERSION = '1.1.0';
export const LEGACY_BACKUP_FORMAT_VERSION = '1.0.0';
export const COMPLETE_TABLE_POLICY_VERSION = 'complete-v1';

export type BackupTableClassification =
  | 'durable-restored'
  | 'cache-optional'
  | 'security-ephemeral';

interface BackupTablePolicyEntry {
  model: string;
  table: string;
  classification: BackupTableClassification;
}

/**
 * Canonical classification and FK-safe insertion order for every Prisma model.
 * Deletion uses the reverse of this order. Security-ephemeral tables are never
 * exported or restored, but are always deleted during restore.
 */
export const COMPLETE_TABLE_POLICY: readonly BackupTablePolicyEntry[] = [
  { model: 'HardwareDeviceModel', table: 'hardwareDeviceModel', classification: 'durable-restored' },
  { model: 'SystemSetting', table: 'systemSetting', classification: 'durable-restored' },
  { model: 'NodeConfig', table: 'nodeConfig', classification: 'durable-restored' },
  { model: 'User', table: 'user', classification: 'durable-restored' },
  { model: 'Group', table: 'group', classification: 'durable-restored' },
  { model: 'FeatureFlag', table: 'featureFlag', classification: 'durable-restored' },
  { model: 'AuditLog', table: 'auditLog', classification: 'durable-restored' },
  { model: 'Wallet', table: 'wallet', classification: 'durable-restored' },
  { model: 'Device', table: 'device', classification: 'durable-restored' },
  { model: 'GroupMember', table: 'groupMember', classification: 'durable-restored' },
  { model: 'PushDevice', table: 'pushDevice', classification: 'security-ephemeral' },
  { model: 'ElectrumServer', table: 'electrumServer', classification: 'durable-restored' },
  { model: 'OwnershipTransfer', table: 'ownershipTransfer', classification: 'durable-restored' },
  { model: 'McpApiKey', table: 'mcpApiKey', classification: 'durable-restored' },
  { model: 'WalletUser', table: 'walletUser', classification: 'durable-restored' },
  { model: 'DeviceUser', table: 'deviceUser', classification: 'durable-restored' },
  { model: 'DeviceAccount', table: 'deviceAccount', classification: 'durable-restored' },
  { model: 'WalletDevice', table: 'walletDevice', classification: 'durable-restored' },
  { model: 'Address', table: 'address', classification: 'durable-restored' },
  { model: 'Label', table: 'label', classification: 'durable-restored' },
  { model: 'DraftTransaction', table: 'draftTransaction', classification: 'durable-restored' },
  { model: 'MobilePermission', table: 'mobilePermission', classification: 'durable-restored' },
  { model: 'WebhookEndpoint', table: 'webhookEndpoint', classification: 'durable-restored' },
  { model: 'WalletAgent', table: 'walletAgent', classification: 'durable-restored' },
  { model: 'VaultPolicy', table: 'vaultPolicy', classification: 'durable-restored' },
  { model: 'AIInsight', table: 'aIInsight', classification: 'durable-restored' },
  { model: 'AIConversation', table: 'aIConversation', classification: 'durable-restored' },
  { model: 'ConsoleSession', table: 'consoleSession', classification: 'durable-restored' },
  { model: 'FeatureFlagAudit', table: 'featureFlagAudit', classification: 'durable-restored' },
  { model: 'Transaction', table: 'transaction', classification: 'durable-restored' },
  { model: 'TransactionOwnershipRepair', table: 'transactionOwnershipRepair', classification: 'durable-restored' },
  { model: 'UTXO', table: 'uTXO', classification: 'durable-restored' },
  { model: 'WebhookDelivery', table: 'webhookDelivery', classification: 'durable-restored' },
  { model: 'AgentApiKey', table: 'agentApiKey', classification: 'durable-restored' },
  { model: 'AgentFundingOverride', table: 'agentFundingOverride', classification: 'durable-restored' },
  { model: 'AgentAlert', table: 'agentAlert', classification: 'durable-restored' },
  { model: 'AgentFundingAttempt', table: 'agentFundingAttempt', classification: 'durable-restored' },
  { model: 'ApprovalRequest', table: 'approvalRequest', classification: 'durable-restored' },
  { model: 'PolicyEvent', table: 'policyEvent', classification: 'durable-restored' },
  { model: 'PolicyAddress', table: 'policyAddress', classification: 'durable-restored' },
  { model: 'PolicyUsageWindow', table: 'policyUsageWindow', classification: 'durable-restored' },
  { model: 'ConsolePromptHistory', table: 'consolePromptHistory', classification: 'durable-restored' },
  { model: 'ConsoleTurn', table: 'consoleTurn', classification: 'durable-restored' },
  { model: 'AIMessage', table: 'aIMessage', classification: 'durable-restored' },
  { model: 'TransactionInput', table: 'transactionInput', classification: 'durable-restored' },
  { model: 'TransactionOutput', table: 'transactionOutput', classification: 'durable-restored' },
  { model: 'TransactionLabel', table: 'transactionLabel', classification: 'durable-restored' },
  { model: 'AddressLabel', table: 'addressLabel', classification: 'durable-restored' },
  { model: 'DraftUtxoLock', table: 'draftUtxoLock', classification: 'durable-restored' },
  { model: 'ApprovalVote', table: 'approvalVote', classification: 'durable-restored' },
  { model: 'ConsoleToolTrace', table: 'consoleToolTrace', classification: 'durable-restored' },
  { model: 'FeeEstimate', table: 'feeEstimate', classification: 'cache-optional' },
  { model: 'PriceData', table: 'priceData', classification: 'cache-optional' },
  { model: 'RefreshToken', table: 'refreshToken', classification: 'security-ephemeral' },
  { model: 'RevokedToken', table: 'revokedToken', classification: 'security-ephemeral' },
  { model: 'EmailVerificationToken', table: 'emailVerificationToken', classification: 'security-ephemeral' },
] as const;

const getTablesByClassification = (classification: BackupTableClassification): string[] =>
  COMPLETE_TABLE_POLICY
    .filter((entry) => entry.classification === classification)
    .map((entry) => entry.table);

export const TABLE_ORDER = getTablesByClassification('durable-restored');
export const CACHE_TABLES = getTablesByClassification('cache-optional');
export const EPHEMERAL_TABLES = getTablesByClassification('security-ephemeral');

/**
 * SHA-256 of JSON.stringify(COMPLETE_TABLE_POLICY). The schema-classification
 * contract test recomputes this value so policy edits cannot retain a stale ID.
 */
export const COMPLETE_TABLE_POLICY_HASH =
  '4bb054ec3a6201df824f6fc717dbbab5939983a63028218e06a20fc0bca8cffe';
/** Policy hash emitted by 1.1.0 before the ownership-repair queue existed. */
export const PREVIOUS_COMPLETE_TABLE_POLICY_HASH =
  'b68866b707d3835f156c5152686290862f0ccc83e6c165ca5798c8a877ce00aa';

const PREVIOUS_COMPLETE_TABLE_ORDER = TABLE_ORDER.filter(
  table => table !== 'transactionOwnershipRepair'
);

const usesPreviousCompletePolicy = (
  meta: Pick<BackupMeta, 'version' | 'tablePolicy'>
): boolean => (
  meta.version === BACKUP_FORMAT_VERSION
  && meta.tablePolicy?.version === COMPLETE_TABLE_POLICY_VERSION
  && meta.tablePolicy.hash === PREVIOUS_COMPLETE_TABLE_POLICY_HASH
);

/**
 * The immutable table manifest used by pre-fix 1.0.0 backups.
 */
export const LEGACY_TABLE_ORDER = [
  'hardwareDeviceModel',
  'systemSetting',
  'nodeConfig',
  'user',
  'mcpApiKey',
  'group',
  'groupMember',
  'device',
  'wallet',
  'pushDevice',
  'electrumServer',
  'walletUser',
  'walletDevice',
  'address',
  'label',
  'walletAgent',
  'draftTransaction',
  'consoleSession',
  'agentApiKey',
  'agentFundingOverride',
  'agentAlert',
  'agentFundingAttempt',
  'consolePromptHistory',
  'consoleTurn',
  'transaction',
  'uTXO',
  'consoleToolTrace',
  'transactionInput',
  'transactionOutput',
  'transactionLabel',
  'addressLabel',
  'draftUtxoLock',
  'auditLog',
] as const;

const BASELINE_RESTORE_SCHEMA_VERSION = 1;

/**
 * Minimum backup schema version that must contain each table for a destructive
 * restore. Backups from older schemas may legitimately predate newer tables,
 * but a current-schema backup that omits one of its known tables is partial and
 * must not be allowed to wipe live data.
 */
export const LEGACY_RESTORE_TABLE_MIN_SCHEMA_VERSION: Record<string, number> = {
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
};

export function getRequiredRestoreTables(
  meta: Pick<BackupMeta, 'version' | 'schemaVersion' | 'includesCache' | 'tablePolicy'>
): string[] {
  let requiredTables: readonly string[] = TABLE_ORDER;
  if (meta.version === LEGACY_BACKUP_FORMAT_VERSION) {
    requiredTables = LEGACY_TABLE_ORDER.filter(
      (table) => meta.schemaVersion >= LEGACY_RESTORE_TABLE_MIN_SCHEMA_VERSION[table]
    );
  } else if (usesPreviousCompletePolicy(meta)) {
    requiredTables = PREVIOUS_COMPLETE_TABLE_ORDER;
  }

  return meta.includesCache
    ? [...requiredTables, ...CACHE_TABLES]
    : [...requiredTables];
}

/**
 * Return the tables whose records may be inserted from this backup. Unlike
 * getRequiredRestoreTables, this excludes legacy security-ephemeral data and
 * is used after completeness validation has succeeded.
 */
export function getRestoreTables(
  meta: Pick<BackupMeta, 'version' | 'includesCache' | 'tablePolicy'>
): string[] {
  let durableTables: readonly string[] = TABLE_ORDER;
  if (meta.version === LEGACY_BACKUP_FORMAT_VERSION) {
    durableTables = LEGACY_TABLE_ORDER.filter((table) => !EPHEMERAL_TABLES.includes(table));
  } else if (usesPreviousCompletePolicy(meta)) {
    durableTables = PREVIOUS_COMPLETE_TABLE_ORDER;
  }

  return meta.includesCache
    ? [...durableTables, ...CACHE_TABLES]
    : [...durableTables];
}

// Tables that can grow large and should use cursor-based pagination for export
// to avoid loading all rows into a single Prisma response buffer at once
export const LARGE_TABLES = new Set([
  'transaction', 'uTXO', 'transactionInput', 'transactionOutput',
  'address', 'auditLog', 'addressLabel', 'transactionLabel',
  'agentFundingAttempt', 'agentAlert', 'consolePromptHistory', 'consoleTurn',
  'consoleToolTrace', 'webhookDelivery', 'featureFlagAudit', 'policyEvent',
  'approvalVote', 'aIInsight', 'aIMessage',
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
