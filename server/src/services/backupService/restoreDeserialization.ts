/**
 * Schema-aware restore deserialization.
 *
 * Field maps deliberately replace heuristic parsing: JSON strings and nested
 * JSON may legitimately resemble ISO dates or BigInt markers. The backup
 * contract tests compare these maps with every restored Prisma DateTime and
 * BigInt field so schema changes cannot drift silently.
 */
import type { BackupRecord } from './types';

export const RESTORE_DATE_FIELDS: Record<string, readonly string[]> = {
  user: ['createdAt', 'updatedAt', 'emailVerifiedAt'],
  group: ['createdAt', 'updatedAt'],
  groupMember: ['createdAt'],
  wallet: ['lastSyncedAt', 'createdAt', 'updatedAt'],
  walletUser: ['createdAt'],
  hardwareDeviceModel: ['createdAt', 'updatedAt'],
  device: ['createdAt', 'updatedAt'],
  deviceAccount: ['createdAt', 'updatedAt'],
  deviceUser: ['createdAt'],
  walletDevice: ['createdAt'],
  address: ['createdAt'],
  transaction: [
    'classificationLastAttemptAt',
    'ioLastAttemptAt',
    'blockTime',
    'createdAt',
    'updatedAt',
  ],
  transactionOwnershipRepair: ['createdAt', 'updatedAt'],
  uTXO: ['createdAt', 'updatedAt'],
  draftTransaction: ['createdAt', 'updatedAt', 'expiresAt', 'approvedAt'],
  draftUtxoLock: ['createdAt'],
  nodeConfig: ['createdAt', 'updatedAt'],
  electrumServer: ['lastHealthCheck', 'lastCapabilityCheck', 'createdAt', 'updatedAt'],
  feeEstimate: ['createdAt'],
  systemSetting: ['createdAt', 'updatedAt'],
  priceData: ['createdAt'],
  label: ['createdAt', 'updatedAt'],
  transactionLabel: ['createdAt'],
  addressLabel: ['createdAt'],
  auditLog: ['createdAt'],
  walletRemediationProposal: ['createdAt'],
  walletRemediationEvent: ['createdAt'],
  webhookEndpoint: ['lastDeliveredAt', 'createdAt', 'updatedAt'],
  webhookDelivery: [
    'nextAttemptAt',
    'attemptLeaseExpiresAt',
    'lastAttemptAt',
    'deliveredAt',
    'createdAt',
    'updatedAt',
  ],
  mcpApiKey: ['lastUsedAt', 'expiresAt', 'createdAt', 'revokedAt'],
  walletAgent: ['lastFundingDraftAt', 'createdAt', 'updatedAt', 'revokedAt'],
  agentFundingOverride: ['expiresAt', 'usedAt', 'revokedAt', 'createdAt', 'updatedAt'],
  agentAlert: ['createdAt', 'acknowledgedAt', 'resolvedAt'],
  agentApiKey: ['lastUsedAt', 'expiresAt', 'createdAt', 'revokedAt'],
  agentFundingAttempt: ['createdAt'],
  ownershipTransfer: ['createdAt', 'updatedAt', 'acceptedAt', 'confirmedAt', 'cancelledAt', 'expiresAt'],
  mobilePermission: ['createdAt', 'updatedAt'],
  featureFlag: ['createdAt', 'updatedAt'],
  featureFlagAudit: ['createdAt'],
  vaultPolicy: ['createdAt', 'updatedAt'],
  approvalRequest: ['vetoDeadline', 'expiresAt', 'resolvedAt', 'createdAt', 'updatedAt'],
  approvalVote: ['createdAt'],
  policyEvent: ['createdAt'],
  policyAddress: ['createdAt'],
  policyUsageWindow: ['windowStart', 'windowEnd', 'updatedAt'],
  aIInsight: ['expiresAt', 'notifiedAt', 'createdAt', 'updatedAt'],
  aIConversation: ['createdAt', 'updatedAt'],
  aIMessage: ['createdAt'],
  consoleSession: ['expiresAt', 'deletedAt', 'createdAt', 'updatedAt'],
  consoleTurn: ['createdAt', 'completedAt'],
  consoleToolTrace: ['createdAt'],
  consolePromptHistory: ['expiresAt', 'deletedAt', 'lastReplayedAt', 'createdAt', 'updatedAt'],
};

export const RESTORE_BIGINT_FIELDS: Record<string, readonly string[]> = {
  transaction: ['amount', 'fee', 'balanceAfter'],
  transactionInput: ['amount'],
  transactionOutput: ['amount'],
  uTXO: ['amount'],
  draftTransaction: ['amount', 'fee', 'totalInput', 'totalOutput', 'changeAmount', 'effectiveAmount'],
  walletAgent: [
    'maxFundingAmountSats',
    'maxOperationalBalanceSats',
    'dailyFundingLimitSats',
    'weeklyFundingLimitSats',
    'minOperationalBalanceSats',
    'largeOperationalSpendSats',
    'largeOperationalFeeSats',
  ],
  agentFundingOverride: ['maxAmountSats'],
  agentAlert: ['amountSats', 'feeSats', 'thresholdSats'],
  agentFundingAttempt: ['amount'],
  policyUsageWindow: ['totalSpent'],
};

const ARRAY_FIELDS: Record<string, readonly string[]> = {
  hardwareDeviceModel: ['connectivity', 'scriptTypes'],
  device: ['connectionTypes'],
  draftTransaction: ['selectedUtxoIds', 'inputPaths', 'signedDeviceIds'],
  webhookEndpoint: ['eventTypes'],
};

const deserializeArrayFields = (table: string, result: BackupRecord): void => {
  for (const field of ARRAY_FIELDS[table] ?? []) {
    const value = result[field];
    if (isLegacyArrayObject(value)) {
      result[field] = Object.keys(value)
        .map(Number)
        .sort((a, b) => a - b)
        .map(index => value[index]);
    }
  }
};

const deserializeDateFields = (table: string, result: BackupRecord): void => {
  for (const field of RESTORE_DATE_FIELDS[table] ?? []) {
    if (typeof result[field] === 'string') {
      result[field] = new Date(result[field]);
    }
  }
};

const deserializeBigIntFields = (table: string, result: BackupRecord): void => {
  for (const field of RESTORE_BIGINT_FIELDS[table] ?? []) {
    const value = result[field];
    if (typeof value === 'string' && value.startsWith('__bigint__')) {
      result[field] = BigInt(value.slice('__bigint__'.length));
    }
  }
};

const isLegacyArrayObject = (value: unknown): value is Record<number, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(key => /^\d+$/.test(key));
};

export function deserializeRecordForTable(table: string, record: BackupRecord): BackupRecord {
  const result = { ...record };
  deserializeArrayFields(table, result);
  deserializeDateFields(table, result);
  deserializeBigIntFields(table, result);
  return result;
}
