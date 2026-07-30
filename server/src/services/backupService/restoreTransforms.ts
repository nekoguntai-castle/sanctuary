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
  warnings: string[]
): BackupRecord[] {
  const smtpConfigured = records.some(
    record => typeof record.key === 'string' &&
      record.key.startsWith('smtp.') &&
      record.value !== JSON.stringify('')
  );
  if (smtpConfigured) {
    warnings.push('SMTP settings restored disabled. Re-enter SMTP credentials before enabling email delivery.');
  }

  return records.map(record => {
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
    if (record.status === 'delivered' || record.status === 'dead') return record;
    return {
      ...record,
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
