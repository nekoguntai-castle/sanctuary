import { systemSettingRepository } from '../repositories';
import { InvalidInputError } from '../errors/ApiError';
import { safeJsonParseUntyped } from '../utils/safeJson';
import { encrypt, isEncrypted } from '../utils/encryption';
import { clearTransporterCache } from './email';
import {
  DEFAULT_AI_ENABLED,
  DEFAULT_AI_ENDPOINT,
  DEFAULT_AI_MODEL,
  DEFAULT_CONFIRMATION_THRESHOLD,
  DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
  DEFAULT_DRAFT_EXPIRATION_DAYS,
  DEFAULT_DUST_THRESHOLD,
  DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS,
  DEFAULT_EMAIL_VERIFICATION_REQUIRED,
  DEFAULT_SMTP_FROM_NAME,
  DEFAULT_SMTP_PORT,
} from '../constants';
import {
  AI_PROVIDER_PROFILE_SETTING_KEYS,
  applyAIProviderProfileSettings,
  hasAIProviderProfileSettingUpdate,
  normalizeAIProviderProfileSettingsUpdate,
  sanitizeAIProviderProfileSettingsUpdate,
} from './ai/providerProfileSettings';
import { AI_PROVIDER_CREDENTIALS_KEY } from './ai/providerCredentials';

type StoredSetting = {
  key: string;
  value: string;
};

export type AdminSettings = Record<string, unknown>;
export type AdminSettingsUpdate = Record<string, unknown>;

const smtpKeys = [
  'smtp.host',
  'smtp.port',
  'smtp.secure',
  'smtp.user',
  'smtp.password',
  'smtp.fromAddress',
  'smtp.fromName',
];

export function buildAdminSettingsResponse(settings: StoredSetting[]): AdminSettings {
  const settingsObj: AdminSettings = {};
  for (const setting of settings) {
    settingsObj[setting.key] = safeJsonParseUntyped(setting.value, setting.value, `setting:${setting.key}`);
  }

  const response: AdminSettings = {
    registrationEnabled: false,
    confirmationThreshold: DEFAULT_CONFIRMATION_THRESHOLD,
    deepConfirmationThreshold: DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
    dustThreshold: DEFAULT_DUST_THRESHOLD,
    draftExpirationDays: DEFAULT_DRAFT_EXPIRATION_DAYS,
    aiEnabled: DEFAULT_AI_ENABLED,
    aiEndpoint: DEFAULT_AI_ENDPOINT,
    aiModel: DEFAULT_AI_MODEL,
    'email.verificationRequired': DEFAULT_EMAIL_VERIFICATION_REQUIRED,
    'email.tokenExpiryHours': DEFAULT_EMAIL_TOKEN_EXPIRY_HOURS,
    'smtp.host': '',
    'smtp.port': DEFAULT_SMTP_PORT,
    'smtp.secure': false,
    'smtp.user': '',
    'smtp.fromAddress': '',
    'smtp.fromName': DEFAULT_SMTP_FROM_NAME,
    'smtp.configured': false,
    ...settingsObj,
  };

  applyAIProviderProfileSettings(response);

  response['smtp.configured'] = !!(response['smtp.host'] && response['smtp.fromAddress']);
  delete response['smtp.password'];

  return response;
}

export async function getAdminSettings(): Promise<AdminSettings> {
  return buildAdminSettingsResponse(await systemSettingRepository.getAll());
}

export async function updateAdminSettings(updates: AdminSettingsUpdate): Promise<AdminSettings> {
  await validateConfirmationThresholds(updates);

  const normalizedUpdates = await normalizeAdminSettingsUpdates(updates);
  const smtpChanged = Object.keys(normalizedUpdates).some((key) => smtpKeys.includes(key));

  for (const [key, value] of Object.entries(normalizedUpdates)) {
    let valueToStore = value;

    if (key === 'smtp.password' && typeof value === 'string' && value.length > 0 && !isEncrypted(value)) {
      valueToStore = encrypt(value);
    }

    await systemSettingRepository.set(key, JSON.stringify(valueToStore));
  }

  if (smtpChanged) {
    clearTransporterCache();
  }

  return getAdminSettings();
}

async function normalizeAdminSettingsUpdates(updates: AdminSettingsUpdate): Promise<AdminSettingsUpdate> {
  const sanitizedUpdates = sanitizeAIProviderProfileSettingsUpdate(updates);

  if (!hasAIProviderProfileSettingUpdate(sanitizedUpdates)) {
    return sanitizedUpdates;
  }

  const currentSettings = await systemSettingRepository.findByKeys([...AI_PROVIDER_PROFILE_SETTING_KEYS]);
  const currentResponse = buildAdminSettingsResponse(currentSettings);
  const currentCredentials = currentSettings.find((setting) => setting.key === AI_PROVIDER_CREDENTIALS_KEY);
  if (currentCredentials) {
    currentResponse[AI_PROVIDER_CREDENTIALS_KEY] = safeJsonParseUntyped(
      currentCredentials.value,
      {},
      `setting:${AI_PROVIDER_CREDENTIALS_KEY}`,
    );
  }
  return normalizeAIProviderProfileSettingsUpdate(sanitizedUpdates, currentResponse);
}

async function validateConfirmationThresholds(updates: AdminSettingsUpdate): Promise<void> {
  if (updates.confirmationThreshold === undefined && updates.deepConfirmationThreshold === undefined) {
    return;
  }

  const currentSettings = await systemSettingRepository.findByKeys([
    'confirmationThreshold',
    'deepConfirmationThreshold',
  ]);
  const currentValues: Record<string, number> = {
    confirmationThreshold: DEFAULT_CONFIRMATION_THRESHOLD,
    deepConfirmationThreshold: DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
  };

  for (const setting of currentSettings) {
    currentValues[setting.key] = safeJsonParseUntyped<number>(
      setting.value,
      currentValues[setting.key],
      `setting:${setting.key}`,
    );
  }

  const newConfirmation = Number(updates.confirmationThreshold ?? currentValues.confirmationThreshold);
  const newDeepConfirmation = Number(updates.deepConfirmationThreshold ?? currentValues.deepConfirmationThreshold);

  if (newDeepConfirmation < newConfirmation) {
    throw new InvalidInputError('Deep confirmation threshold must be greater than or equal to confirmation threshold');
  }
}
