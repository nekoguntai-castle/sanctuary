/**
 * Fail-closed transforms for credentials embedded in durable backup records.
 *
 * Restoring these values verbatim could reactivate external access, deliveries,
 * or authenticated sessions in a different trust boundary. Metadata is kept
 * where useful, while operational secrets and enabled states are neutralized.
 */
import { isEncrypted, decrypt } from '../../utils/encryption';
import { safeJsonParseUntyped } from '../../utils/safeJson';
import {
  AI_PROVIDER_CREDENTIALS_KEY,
  disableAIProviderCredentialsForRestore,
} from '../ai/providerCredentials';
import type { BackupRecord } from './types';
import { redactWebhookDiagnosticHeaders } from '../webhooks/diagnostics';
import {
  isOperationalSystemSettingKey,
  STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
  WALLET_SYNC_ACTIVATION_KEY,
} from '../../repositories/operationalSystemSettings';
import { parseStaleWalletScheduleTombstone } from '../../repositories/walletSyncSchedulePolicyRepository';
import {
  assertCurrentBinarySupportsWalletSyncActivation,
  parseWalletSyncActivation,
} from '../../repositories/walletSyncActivationPolicyRepository';

const WALLET_INCREMENTAL_SYNC_FIELDS = [
  'requestedIncrementalSyncGeneration',
  'claimedIncrementalSyncGeneration',
  'processedIncrementalSyncGeneration',
  'incrementalSyncLeaseToken',
  'incrementalSyncClaimedAt',
  'incrementalSyncLeaseExpiresAt',
  'syncActionRequiredAt',
  'preparedFullResyncGeneration',
] as const;

export function processNodeConfigRecords(
  records: BackupRecord[],
  warnings: string[]
): BackupRecord[] {
  const credentialCount = records.filter(
    record => record.proxyEnabled === true || Boolean(record.proxyPassword)
  ).length;
  if (credentialCount > 0) {
    warnings.push(
      `${credentialCount} node proxy configuration${credentialCount === 1 ? '' : 's'} restored disabled. Re-enter proxy credentials before enabling proxy access.`
    );
  }
  return records.map(record => ({
    ...record,
    proxyEnabled: false,
    proxyPassword: null,
  }));
}

export function processUserRecords(
  records: BackupRecord[],
  warnings: string[],
  currentSessionVersions: ReadonlyMap<string, number>
): BackupRecord[] {
  return records.map(record => {
    const sessionInvalidated = invalidateUserSessions(record, currentSessionVersions);
    const telegramDisabled = disableTelegramCredentials(sessionInvalidated, warnings);
    return disableUndecryptableTwoFactor(telegramDisabled, warnings);
  });
}

export function processSystemSettingRecords(
  records: BackupRecord[],
  warnings: string[],
  preservedOperationalKeys: ReadonlySet<string> = new Set(),
): BackupRecord[] {
  const smtpConfigured = records.some(
    record => typeof record.key === 'string' &&
      record.key.startsWith('smtp.') &&
      record.value !== JSON.stringify('')
  );
  if (smtpConfigured) {
    warnings.push('SMTP settings restored disabled. Re-enter SMTP credentials before enabling email delivery.');
  }

  return records
    .filter(record => shouldRestoreSystemSetting(record, preservedOperationalKeys))
    .map(record => {
      const aiRecord = disableAIProviderCredentialRecord(record, warnings);
      if (typeof aiRecord.key !== 'string' || !aiRecord.key.startsWith('smtp.')) {
        return aiRecord;
      }
      if (['smtp.host', 'smtp.user', 'smtp.password', 'smtp.fromAddress'].includes(aiRecord.key)) {
        return { ...aiRecord, value: JSON.stringify('') };
      }
      return aiRecord;
    });
}

function shouldRestoreSystemSetting(
  record: BackupRecord,
  preservedOperationalKeys: ReadonlySet<string>,
): boolean {
  if (typeof record.key !== 'string' || !isOperationalSystemSettingKey(record.key)) {
    return true;
  }
  if (record.key === STALE_WALLET_SCHEDULE_FORBIDDEN_KEY) {
    validateRestorableOperationalSetting(
      record,
      parseStaleWalletScheduleTombstone,
      'Invalid durable stale-wallet schedule tombstone',
    );
    return !preservedOperationalKeys.has(STALE_WALLET_SCHEDULE_FORBIDDEN_KEY);
  }
  if (record.key === WALLET_SYNC_ACTIVATION_KEY) {
    validateRestorableWalletSyncActivation(record);
    return !preservedOperationalKeys.has(WALLET_SYNC_ACTIVATION_KEY);
  }
  return false;
}

function validateRestorableOperationalSetting(
  record: BackupRecord,
  parse: (value: string) => unknown,
  invalidMessage: string,
): void {
  if (typeof record.value !== 'string') throw new Error(invalidMessage);
  parse(record.value);
}

function validateRestorableWalletSyncActivation(record: BackupRecord): void {
  if (typeof record.value !== 'string') {
    throw new Error('Invalid durable wallet-sync activation policy');
  }
  const activation = parseWalletSyncActivation(record.value);
  assertCurrentBinarySupportsWalletSyncActivation(activation);
}

export function processWalletSyncIntentRecords(
  records: BackupRecord[],
): BackupRecord[] {
  return records.map(processWalletSyncIntentRecord);
}

/**
 * Backfill the durable coverage clock for backups written before the field.
 * Settled checkpoints have no open gap; pending checkpoints inherit createdAt
 * so restore cannot make an old gap look new. Missing provenance fails closed.
 */
export function processSubscriptionCheckpointCoverageRecords(
  records: BackupRecord[],
): BackupRecord[] {
  return records.map((record) => {
    const normalized = record.network === 'testnet'
      ? { ...record, network: 'testnet3' }
      : record;
    if ('coverageGapStartedAt' in normalized) return normalized;
    const settled = normalized.statusKnown === true
      && Number(normalized.processedEnrollmentGeneration)
        === Number(normalized.requestedEnrollmentGeneration);
    if (settled) return { ...normalized, coverageGapStartedAt: null };
    if (
      !(normalized.createdAt instanceof Date)
      || !Number.isFinite(normalized.createdAt.getTime())
    ) {
      throw new Error('Restored pending subscription checkpoint is missing its durable gap start');
    }
    return { ...normalized, coverageGapStartedAt: normalized.createdAt };
  });
}

function processWalletSyncIntentRecord(record: BackupRecord): BackupRecord {
  const presentFields = WALLET_INCREMENTAL_SYNC_FIELDS.filter(field => field in record);
  if (presentFields.length === WALLET_INCREMENTAL_SYNC_FIELDS.length) {
    return normalizeRestoredSyncAuthority(record);
  }
  if (presentFields.length !== 0) {
    throw new Error('Wallet backup contains a partial incremental-sync compatibility state');
  }

  const hasProvenSuccess = record.lastSyncedAt != null;
  const hasUnfinishedLegacyWork = !hasProvenSuccess
    || record.syncInProgress === true
    || (record.lastSyncStatus != null && record.lastSyncStatus !== 'success');
  const requiresAction = record.lastSyncStatus === 'failed'
    && record.syncInProgress === false;
  const legacyProcessedFullResyncGeneration = normalizeGeneration(
    record.processedFullResyncGeneration,
  );

  return normalizeRestoredSyncAuthority({
    ...record,
    requestedIncrementalSyncGeneration: hasUnfinishedLegacyWork ? 1 : 0,
    claimedIncrementalSyncGeneration: 0,
    processedIncrementalSyncGeneration: 0,
    incrementalSyncLeaseToken: null,
    incrementalSyncClaimedAt: null,
    incrementalSyncLeaseExpiresAt: null,
    syncActionRequiredAt: requiresAction ? record.updatedAt ?? null : null,
    preparedFullResyncGeneration: legacyProcessedFullResyncGeneration,
    processedFullResyncGeneration: hasProvenSuccess
      ? legacyProcessedFullResyncGeneration
      : 0,
  });
}

function normalizeRestoredSyncAuthority(record: BackupRecord): BackupRecord {
  const processedIncremental = normalizeGeneration(
    record.processedIncrementalSyncGeneration,
  );
  const claimedIncremental = normalizeGeneration(
    record.claimedIncrementalSyncGeneration,
  );
  const hadExecutionAuthority = hasRestoredExecutionAuthority(
    record,
    claimedIncremental,
    processedIncremental,
  );
  const hasDurableWork = normalizeGeneration(record.requestedIncrementalSyncGeneration)
      > processedIncremental
    || normalizeGeneration(record.requestedFullResyncGeneration)
      > normalizeGeneration(record.processedFullResyncGeneration);
  const requestedIncremental = hadExecutionAuthority && !hasDurableWork
    ? nextGeneration(processedIncremental)
    : record.requestedIncrementalSyncGeneration;

  return {
    ...record,
    requestedIncrementalSyncGeneration: requestedIncremental,
    claimedIncrementalSyncGeneration: processedIncremental,
    incrementalSyncLeaseToken: null,
    incrementalSyncClaimedAt: null,
    incrementalSyncLeaseExpiresAt: null,
    syncInProgress: false,
    syncExecutionOwner: null,
    syncStartedAt: null,
    ...(hadExecutionAuthority && record.syncActionRequiredAt == null
      ? { lastSyncStatus: 'retrying' }
      : {}),
  };
}

function hasRestoredExecutionAuthority(
  record: BackupRecord,
  claimedIncremental: number,
  processedIncremental: number,
): boolean {
  return record.syncInProgress === true
    || record.syncExecutionOwner != null
    || record.syncStartedAt != null
    || record.incrementalSyncLeaseToken != null
    || record.incrementalSyncClaimedAt != null
    || record.incrementalSyncLeaseExpiresAt != null
    || claimedIncremental > processedIncremental
    || record.lastSyncStatus === 'syncing'
    || record.lastSyncStatus === 'resyncing';
}

function nextGeneration(generation: number): number {
  if (generation >= 2_147_483_647) {
    throw new Error('Restored wallet sync generation cannot retain active legacy work');
  }
  return generation + 1;
}

function normalizeGeneration(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

export function processMcpApiKeyRecords(
  records: BackupRecord[],
  warnings: string[]
): BackupRecord[] {
  return revokeApiKeyRecords(
    records,
    warnings,
    'MCP API key',
    'Regenerate MCP client credentials after reviewing external access.'
  );
}

export function processAgentApiKeyRecords(
  records: BackupRecord[],
  warnings: string[]
): BackupRecord[] {
  return revokeApiKeyRecords(
    records,
    warnings,
    'agent API key',
    'Regenerate agent credentials after reviewing external access.'
  );
}

export function processWebhookEndpointRecords(
  records: BackupRecord[],
  warnings: string[]
): BackupRecord[] {
  const disabledCount = records.filter(
    record =>
      record.enabled === true ||
      Boolean(record.secretEncrypted) ||
      Boolean(record.headerConfig)
  ).length;
  if (disabledCount > 0) {
    const label = `webhook endpoint${disabledCount === 1 ? '' : 's'}`;
    warnings.push(
      `${disabledCount} ${label} restored disabled. Re-enter webhook credentials and review destinations before enabling delivery.`
    );
  }
  return records.map(record => ({
    ...record,
    enabled: false,
    secretEncrypted: null,
    headerConfig: null,
  }));
}

export function processWebhookDeliveryRecords(records: BackupRecord[]): BackupRecord[] {
  return records.map(record => {
    const sanitizedRecord = {
      ...record,
      requestHeadersRedacted: redactWebhookDiagnosticHeaders(record.requestHeadersRedacted),
    };
    if (record.status === 'delivered' || record.status === 'dead') return sanitizedRecord;
    return {
      ...sanitizedRecord,
      status: 'dead',
      nextAttemptAt: null,
      lastError: 'Delivery disabled after backup restore; replay manually after reviewing the endpoint.',
    };
  });
}

const MAX_SESSION_VERSION = 2_147_483_647;

/**
 * Advance beyond both the backed-up and currently live session generations so
 * neither token population survives. Throwing at the database integer ceiling
 * is safer than clamping, which could leave a maximum-generation token valid.
 */
function invalidateUserSessions(
  record: BackupRecord,
  currentSessionVersions: ReadonlyMap<string, number>
): BackupRecord {
  const userId = typeof record.id === 'string' ? record.id : '';
  const backedUpVersion = normalizeSessionVersion(record.sessionVersion);
  const currentVersion = normalizeSessionVersion(currentSessionVersions.get(userId));
  const highestVersion = Math.max(backedUpVersion, currentVersion);
  if (highestVersion >= MAX_SESSION_VERSION) {
    throw new Error(`Cannot safely invalidate sessions for restored user ${userId || '<unknown>'}`);
  }
  return { ...record, sessionVersion: highestVersion + 1 };
}

function normalizeSessionVersion(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function disableTelegramCredentials(record: BackupRecord, warnings: string[]): BackupRecord {
  if (!record.preferences || typeof record.preferences !== 'object' || Array.isArray(record.preferences)) {
    return record;
  }
  const preferences = record.preferences as BackupRecord;
  if (!preferences.telegram || typeof preferences.telegram !== 'object' || Array.isArray(preferences.telegram)) {
    return record;
  }
  const telegram = preferences.telegram as BackupRecord;
  if (telegram.enabled === true || telegram.botToken || telegram.chatId) {
    warnings.push(
      `Telegram notifications for user "${record.username}" restored disabled. Re-enter Telegram credentials before enabling notifications.`
    );
  }
  return {
    ...record,
    preferences: {
      ...preferences,
      telegram: { ...telegram, enabled: false, botToken: '', chatId: '' },
    },
  };
}

function disableUndecryptableTwoFactor(record: BackupRecord, warnings: string[]): BackupRecord {
  const secret = record.twoFactorSecret;
  if (typeof secret !== 'string' || !isEncrypted(secret)) return record;
  try {
    decrypt(secret);
    return record;
  } catch {
    warnings.push(
      `2FA for user "${record.username}" could not be restored (encrypted with different key). User will need to re-setup 2FA.`
    );
    return {
      ...record,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
    };
  }
}

function disableAIProviderCredentialRecord(
  record: BackupRecord,
  warnings: string[]
): BackupRecord {
  if (record.key !== AI_PROVIDER_CREDENTIALS_KEY || typeof record.value !== 'string') return record;
  const value = safeJsonParseUntyped(record.value, {}, `setting:${AI_PROVIDER_CREDENTIALS_KEY}`);
  const result = disableAIProviderCredentialsForRestore(value);
  if (result.disabledCount > 0) {
    const label = `AI provider credential${result.disabledCount === 1 ? '' : 's'}`;
    warnings.push(
      `${result.disabledCount} ${label} restored disabled. Re-enter provider credentials in Admin > AI Settings before enabling external model access.`
    );
  }
  return { ...record, value: JSON.stringify(result.credentials) };
}

function revokeApiKeyRecords(
  records: BackupRecord[],
  warnings: string[],
  singularLabel: string,
  instruction: string
): BackupRecord[] {
  const restoreRevokedAt = new Date();
  const unrevokedCount = records.filter(record => !record.revokedAt).length;
  if (unrevokedCount > 0) {
    warnings.push(
      `${unrevokedCount} ${singularLabel}${unrevokedCount === 1 ? '' : 's'} restored revoked. ${instruction}`
    );
  }
  return records.map(record => ({
    ...record,
    revokedAt: record.revokedAt ?? restoreRevokedAt,
  }));
}
