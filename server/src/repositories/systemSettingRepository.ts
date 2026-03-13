/**
 * System Setting Repository
 *
 * Abstracts database operations for system-wide settings.
 */

import prisma from '../models/prisma';
import type { SystemSetting } from '@prisma/client';
import { safeJsonParseUntyped } from '../utils/safeJson';
import { createLogger } from '../utils/logger';

const log = createLogger('SystemSettingRepo');

/**
 * Well-known system setting keys
 */
export const SystemSettingKeys = {
  // Server settings
  SERVER_NAME: 'server.name',
  SERVER_DESCRIPTION: 'server.description',

  // Feature flags
  REGISTRATION_ENABLED: 'registration.enabled',
  REGISTRATION_REQUIRE_APPROVAL: 'registration.requireApproval',

  // Email verification settings
  EMAIL_VERIFICATION_REQUIRED: 'email.verificationRequired',
  EMAIL_VERIFICATION_TOKEN_EXPIRY_HOURS: 'email.tokenExpiryHours',

  // SMTP settings
  SMTP_HOST: 'smtp.host',
  SMTP_PORT: 'smtp.port',
  SMTP_SECURE: 'smtp.secure',
  SMTP_USER: 'smtp.user',
  SMTP_PASSWORD: 'smtp.password',
  SMTP_FROM_ADDRESS: 'smtp.fromAddress',
  SMTP_FROM_NAME: 'smtp.fromName',

  // Sync settings
  SYNC_INTERVAL_MS: 'sync.intervalMs',
  SYNC_BATCH_SIZE: 'sync.batchSize',

  // Price settings
  PRICE_CACHE_DURATION_MS: 'price.cacheDurationMs',
  PRICE_DEFAULT_CURRENCY: 'price.defaultCurrency',

  // Maintenance settings
  MAINTENANCE_MODE: 'maintenance.mode',
  MAINTENANCE_MESSAGE: 'maintenance.message',

  // Rate limiting
  RATE_LIMIT_REQUESTS: 'rateLimit.requests',
  RATE_LIMIT_WINDOW_MS: 'rateLimit.windowMs',

  // Monitoring URL overrides
  MONITORING_GRAFANA_URL: 'monitoring.grafanaUrl',
  MONITORING_PROMETHEUS_URL: 'monitoring.prometheusUrl',
  MONITORING_JAEGER_URL: 'monitoring.jaegerUrl',

  // Grafana settings
  GRAFANA_ANONYMOUS_ACCESS: 'grafana.anonymousAccess',
} as const;

export type SystemSettingKey = typeof SystemSettingKeys[keyof typeof SystemSettingKeys];

/**
 * Get a system setting by key
 */
export async function get(key: string): Promise<SystemSetting | null> {
  return prisma.systemSetting.findUnique({
    where: { key },
  });
}

/**
 * Get a setting value (returns null if not found)
 */
export async function getValue(key: string): Promise<string | null> {
  const setting = await get(key);
  return setting?.value ?? null;
}

/**
 * Get a setting value with a default
 */
export async function getValueOrDefault(
  key: string,
  defaultValue: string
): Promise<string> {
  const value = await getValue(key);
  return value ?? defaultValue;
}

/**
 * Get a boolean setting
 */
export async function getBoolean(
  key: string,
  defaultValue: boolean = false
): Promise<boolean> {
  const value = await getValue(key);
  if (value === null) return defaultValue;
  return value === 'true' || value === '1';
}

/**
 * Get a number setting
 */
export async function getNumber(
  key: string,
  defaultValue: number = 0
): Promise<number> {
  const value = await getValue(key);
  if (value === null) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a JSON setting
 */
export async function getJson<T>(
  key: string,
  defaultValue?: T
): Promise<T | undefined> {
  const value = await getValue(key);
  if (value === null) return defaultValue;
  return safeJsonParseUntyped<T | undefined>(value, defaultValue, `systemSetting:${key}`);
}

/**
 * Get all system settings
 */
export async function getAll(): Promise<SystemSetting[]> {
  return prisma.systemSetting.findMany({
    orderBy: { key: 'asc' },
  });
}

/**
 * Get settings by prefix
 */
export async function getByPrefix(prefix: string): Promise<SystemSetting[]> {
  return prisma.systemSetting.findMany({
    where: {
      key: { startsWith: prefix },
    },
    orderBy: { key: 'asc' },
  });
}

/**
 * Get settings as a key-value map
 */
export async function getAllAsMap(): Promise<Record<string, string>> {
  const settings = await getAll();
  const map: Record<string, string> = {};
  for (const setting of settings) {
    map[setting.key] = setting.value;
  }
  return map;
}

/**
 * Set a system setting (upsert)
 */
export async function set(key: string, value: string): Promise<SystemSetting> {
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/**
 * Set a boolean setting
 */
export async function setBoolean(
  key: string,
  value: boolean
): Promise<SystemSetting> {
  return set(key, value ? 'true' : 'false');
}

/**
 * Set a number setting
 */
export async function setNumber(
  key: string,
  value: number
): Promise<SystemSetting> {
  return set(key, String(value));
}

/**
 * Set a JSON setting
 */
export async function setJson(
  key: string,
  value: unknown
): Promise<SystemSetting> {
  return set(key, JSON.stringify(value));
}

/**
 * Set multiple settings at once
 */
export async function setMany(
  settings: Array<{ key: string; value: string }>
): Promise<void> {
  await prisma.$transaction(
    settings.map(s =>
      prisma.systemSetting.upsert({
        where: { key: s.key },
        update: { value: s.value },
        create: { key: s.key, value: s.value },
      })
    )
  );
}

/**
 * Delete a system setting
 */
export async function deleteSetting(key: string): Promise<void> {
  await prisma.systemSetting.delete({
    where: { key },
  }).catch((err) => {
    log.debug('Setting not found for deletion', { key, error: String(err) });
  });
}

/**
 * Delete settings by prefix
 */
export async function deleteByPrefix(prefix: string): Promise<number> {
  const result = await prisma.systemSetting.deleteMany({
    where: {
      key: { startsWith: prefix },
    },
  });
  return result.count;
}

/**
 * Check if a setting exists
 */
export async function exists(key: string): Promise<boolean> {
  const count = await prisma.systemSetting.count({
    where: { key },
  });
  return count > 0;
}

// Export as namespace
export const systemSettingRepository = {
  get,
  getValue,
  getValueOrDefault,
  getBoolean,
  getNumber,
  getJson,
  getAll,
  getByPrefix,
  getAllAsMap,
  set,
  setBoolean,
  setNumber,
  setJson,
  setMany,
  delete: deleteSetting,
  deleteByPrefix,
  exists,
  // Well-known keys
  Keys: SystemSettingKeys,
};

export default systemSettingRepository;
