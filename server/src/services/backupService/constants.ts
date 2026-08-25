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
  { model: 'WalletRemediationProposal', table: 'walletRemediationProposal', classification: 'durable-restored' },
  { model: 'WalletRemediationEvent', table: 'walletRemediationEvent', classification: 'durable-restored' },
  { model: 'Wallet', table: 'wallet', classification: 'durable-restored' },
  { model: 'Device', table: 'device', classification: 'durable-restored' },
  { model: 'GroupMember', table: 'groupMember', classification: 'durable-restored' },
  { model: 'PushDevice', table: 'pushDevice', classification: 'security-ephemeral' },
  { model: 'TransactionSigningIntent', table: 'transactionSigningIntent', classification: 'security-ephemeral' },
  { model: 'ElectrumServer', table: 'electrumServer', classification: 'durable-restored' },
  { model: 'OwnershipTransfer', table: 'ownershipTransfer', classification: 'durable-restored' },
  { model: 'McpApiKey', table: 'mcpApiKey', classification: 'durable-restored' },
  { model: 'WalletUser', table: 'walletUser', classification: 'durable-restored' },
  { model: 'DeviceUser', table: 'deviceUser', classification: 'durable-restored' },
  { model: 'DeviceAccount', table: 'deviceAccount', classification: 'durable-restored' },
  { model: 'WalletDevice', table: 'walletDevice', classification: 'durable-restored' },
  { model: 'Address', table: 'address', classification: 'durable-restored' },
  { model: 'AddressSubscriptionCheckpoint', table: 'addressSubscriptionCheckpoint', classification: 'durable-restored' },
  { model: 'AddressSubscriptionComparisonFailure', table: 'addressSubscriptionComparisonFailure', classification: 'durable-restored' },
  { model: 'NetworkSubscriptionCoverageState', table: 'networkSubscriptionCoverageState', classification: 'durable-restored' },
  { model: 'NetworkHeaderCheckpoint', table: 'networkHeaderCheckpoint', classification: 'durable-restored' },
  // In-flight proof can be discarded on restore: the retained authoritative
  // checkpoint reopens a gap and rebuilds this bounded operational state.
  { model: 'NetworkHeaderReconciliation', table: 'networkHeaderReconciliation', classification: 'cache-optional' },
  { model: 'NetworkHeaderConfirmationRetry', table: 'networkHeaderConfirmationRetry', classification: 'cache-optional' },
  { model: 'NetworkHeaderReconciliationHeader', table: 'networkHeaderReconciliationHeader', classification: 'cache-optional' },
  { model: 'NetworkHeaderHistory', table: 'networkHeaderHistory', classification: 'cache-optional' },
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
  { model: 'RevokedRefreshSessionFamily', table: 'revokedRefreshSessionFamily', classification: 'security-ephemeral' },
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
const PRE_HEADER_RECONCILIATION_CACHE_TABLES = CACHE_TABLES.filter(
  table => table !== 'networkHeaderReconciliation'
    && table !== 'networkHeaderConfirmationRetry'
    && table !== 'networkHeaderReconciliationHeader'
    && table !== 'networkHeaderHistory',
);

/**
 * SHA-256 of JSON.stringify(COMPLETE_TABLE_POLICY). The schema-classification
 * contract test recomputes this value so policy edits cannot retain a stale ID.
 */
export const COMPLETE_TABLE_POLICY_HASH =
  '919c754086a55684ac902b681638a42fa4c0ccb71bb73363b2db7b6d7a45c694';
/** Policy hash emitted before optional header reconciliation/cache tables existed. */
export const PRE_HEADER_RECONCILIATION_COMPLETE_TABLE_POLICY_HASH =
  'a56baac6fa3430f1b15dd3bd1e979ab6072e08fef0c1adc3c8846bf249eee6b7';
/** Policy hash emitted before durable subscription-coverage evidence existed. */
export const PRE_SUBSCRIPTION_COVERAGE_COMPLETE_TABLE_POLICY_HASH =
  'c3bf72c902b852c9f8546656f6e8915be39ae380c7b44990be4d623d28b020c9';
/** Policy hash emitted before durable per-network header checkpoints existed. */
export const PRE_HEADER_CHECKPOINT_COMPLETE_TABLE_POLICY_HASH =
  '594949940eebbc3590f682ec374580a3617180b479618e27d175cd05cf728240';
/** Policy hash emitted before durable address-subscription checkpoints existed. */
export const PRE_WALLET_SYNC_COMPLETE_TABLE_POLICY_HASH =
  '266399aca02ff5a79cec4b8c89d7a33fc11d7ade0c1942f682e0098896b4acf0';
/** Policy hash emitted immediately before immutable remediation evidence. */
export const PRE_REMEDIATION_COMPLETE_TABLE_POLICY_HASH =
  'b0b58ce73c7b90801f46805b962ce926114d093c098b993b5f50c5809b0372d2';
/** Policy hash emitted before signing intents were classified as ephemeral. */
export const PRE_SIGNING_INTENT_COMPLETE_TABLE_POLICY_HASH =
  '2397989d349da19dff9f2385acf0135b073d9494a957bca490cf998f6fdaf5e8';
/** Policy hash emitted before refresh-session-family tombstones were classified. */
export const PRE_TOMBSTONE_COMPLETE_TABLE_POLICY_HASH =
  '4bb054ec3a6201df824f6fc717dbbab5939983a63028218e06a20fc0bca8cffe';
/** Policy hash emitted by 1.1.0 before the ownership-repair queue existed. */
export const PREVIOUS_COMPLETE_TABLE_POLICY_HASH =
  'b68866b707d3835f156c5152686290862f0ccc83e6c165ca5798c8a877ce00aa';

export const IMMUTABLE_EVIDENCE_TABLES = [
  'walletRemediationProposal',
  'walletRemediationEvent',
] as const;

// Historical table orders chain newest-first: each one filters the order that
// came after it, so it reconstructs exactly the tables that existed when that
// policy hash was emitted. A new durable table extends this chain at the HEAD —
// derive a new PRE_* order from TABLE_ORDER and re-point the current head at
// it. Filtering TABLE_ORDER directly for an older policy would silently start
// demanding a table that policy never wrote.
const PRE_SUBSCRIPTION_COVERAGE_COMPLETE_TABLE_ORDER = TABLE_ORDER.filter(
  table => table !== 'addressSubscriptionComparisonFailure'
    && table !== 'networkSubscriptionCoverageState'
);

const PRE_HEADER_CHECKPOINT_COMPLETE_TABLE_ORDER = PRE_SUBSCRIPTION_COVERAGE_COMPLETE_TABLE_ORDER.filter(
  table => table !== 'networkHeaderCheckpoint'
);

const PRE_WALLET_SYNC_COMPLETE_TABLE_ORDER = PRE_HEADER_CHECKPOINT_COMPLETE_TABLE_ORDER.filter(
  table => table !== 'addressSubscriptionCheckpoint'
);

const PRE_REMEDIATION_COMPLETE_TABLE_ORDER = PRE_WALLET_SYNC_COMPLETE_TABLE_ORDER.filter(
  table => !IMMUTABLE_EVIDENCE_TABLES.includes(
    table as (typeof IMMUTABLE_EVIDENCE_TABLES)[number],
  )
);

const PREVIOUS_COMPLETE_TABLE_ORDER = PRE_REMEDIATION_COMPLETE_TABLE_ORDER.filter(
  table => table !== 'transactionOwnershipRepair'
);

/**
 * Every complete-policy hash we still accept, mapped to the durable tables that
 * existed when it was emitted. One map rather than a predicate-per-generation
 * keeps the two restore-table selectors from drifting apart: adding a table
 * means adding one row here, not editing two parallel if/else chains.
 */
const HISTORICAL_COMPLETE_TABLE_ORDERS: ReadonlyMap<string, readonly string[]> = new Map([
  [PRE_HEADER_RECONCILIATION_COMPLETE_TABLE_POLICY_HASH, TABLE_ORDER],
  [
    PRE_SUBSCRIPTION_COVERAGE_COMPLETE_TABLE_POLICY_HASH,
    PRE_SUBSCRIPTION_COVERAGE_COMPLETE_TABLE_ORDER,
  ],
  [PRE_HEADER_CHECKPOINT_COMPLETE_TABLE_POLICY_HASH, PRE_HEADER_CHECKPOINT_COMPLETE_TABLE_ORDER],
  [PRE_WALLET_SYNC_COMPLETE_TABLE_POLICY_HASH, PRE_WALLET_SYNC_COMPLETE_TABLE_ORDER],
  [PRE_REMEDIATION_COMPLETE_TABLE_POLICY_HASH, PRE_REMEDIATION_COMPLETE_TABLE_ORDER],
  [PRE_TOMBSTONE_COMPLETE_TABLE_POLICY_HASH, PRE_REMEDIATION_COMPLETE_TABLE_ORDER],
  [PRE_SIGNING_INTENT_COMPLETE_TABLE_POLICY_HASH, PRE_REMEDIATION_COMPLETE_TABLE_ORDER],
  [PREVIOUS_COMPLETE_TABLE_POLICY_HASH, PREVIOUS_COMPLETE_TABLE_ORDER],
]);

/**
 * Whether a complete-policy hash is one we still know how to restore: the
 * current policy, or any generation in the historical registry. Derived from
 * the same map the table orders come from, so a hash can never be accepted
 * without a matching table order.
 */
export function isRecognizedCompleteTablePolicyHash(hash: string): boolean {
  return hash === COMPLETE_TABLE_POLICY_HASH || HISTORICAL_COMPLETE_TABLE_ORDERS.has(hash);
}

/**
 * The durable tables a complete-format backup carries, or null when the backup
 * is not a recognized older complete-policy generation (current policy, or the
 * legacy format the callers handle themselves).
 */
const historicalCompleteTableOrder = (
  meta: Pick<BackupMeta, 'version' | 'tablePolicy'>
): readonly string[] | null => {
  if (meta.version !== BACKUP_FORMAT_VERSION) return null;
  if (meta.tablePolicy?.version !== COMPLETE_TABLE_POLICY_VERSION) return null;
  return HISTORICAL_COMPLETE_TABLE_ORDERS.get(meta.tablePolicy.hash) ?? null;
};

/** Cache tables actually emitted by this backup-policy generation. */
function restoreCacheTables(
  meta: Pick<BackupMeta, 'version' | 'includesCache' | 'tablePolicy'>,
): readonly string[] {
  if (!meta.includesCache) return [];
  const hasCurrentPolicy = meta.version === BACKUP_FORMAT_VERSION
    && meta.tablePolicy?.version === COMPLETE_TABLE_POLICY_VERSION
    && meta.tablePolicy.hash === COMPLETE_TABLE_POLICY_HASH;
  return hasCurrentPolicy ? CACHE_TABLES : PRE_HEADER_RECONCILIATION_CACHE_TABLES;
}

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
  } else {
    requiredTables = historicalCompleteTableOrder(meta) ?? TABLE_ORDER;
  }

  return [...requiredTables, ...restoreCacheTables(meta)];
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
  } else {
    durableTables = historicalCompleteTableOrder(meta) ?? TABLE_ORDER;
  }

  return [...durableTables, ...restoreCacheTables(meta)];
}

// Tables that can grow large and the unique, stable string field used for
// cursor pagination. Keep the field beside the table declaration: most models
// use `id`, while AddressSubscriptionCheckpoint is keyed by `addressId`.
export const LARGE_TABLE_CURSOR_FIELDS: ReadonlyMap<string, string> = new Map([
  ['transaction', 'id'], ['uTXO', 'id'], ['transactionInput', 'id'], ['transactionOutput', 'id'],
  ['address', 'id'], ['auditLog', 'id'], ['addressLabel', 'id'], ['transactionLabel', 'id'],
  ['addressSubscriptionCheckpoint', 'addressId'],
  ['addressSubscriptionComparisonFailure', 'addressId'],
  ['agentFundingAttempt', 'id'], ['agentAlert', 'id'], ['consolePromptHistory', 'id'],
  ['consoleTurn', 'id'], ['consoleToolTrace', 'id'], ['webhookDelivery', 'id'],
  ['featureFlagAudit', 'id'], ['policyEvent', 'id'], ['approvalVote', 'id'],
  ['aIInsight', 'id'], ['aIMessage', 'id'],
]);

export const LARGE_TABLES = new Set(LARGE_TABLE_CURSOR_FIELDS.keys());

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
