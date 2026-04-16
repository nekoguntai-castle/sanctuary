/**
 * Backup Serialization
 *
 * Handles serialization and deserialization of backup records.
 * Converts between Prisma model types (Date, BigInt) and JSON-safe representations.
 */

import type { BackupRecord } from './types';

/**
 * Serialize a record for JSON export (converts BigInt to string)
 */
export function serializeRecord(record: BackupRecord): BackupRecord {
  const serialized: BackupRecord = {};

  for (const key of Object.keys(record)) {
    serialized[key] = serializeValue(record[key]);
  }

  return serialized;
}

/**
 * Serialize a single value for JSON export
 */
function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'bigint') {
    // Store BigInt as string with special marker for restore
    return `__bigint__${value.toString()}`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    // Preserve arrays, serialize each element
    return value.map((item: unknown) => serializeValue(item));
  }
  if (typeof value === 'object') {
    // Recursively handle nested objects
    return serializeRecord(value as BackupRecord);
  }
  return value;
}

/**
 * Process a record to convert string dates back to Date objects
 * and BigInt markers back to BigInt
 */
export function processRecord(record: BackupRecord): BackupRecord {
  const processed: BackupRecord = { ...record };

  for (const key of Object.keys(processed)) {
    processed[key] = processValue(processed[key]);
  }

  return processed;
}

/**
 * Process a single value during restore
 */
function processValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    // Check for BigInt marker
    if (value.startsWith('__bigint__')) {
      return BigInt(value.replace('__bigint__', ''));
    }
    // Check for ISO date string
    if (isISODateString(value)) {
      return new Date(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    // Process each array element
    return value.map((item: unknown) => processValue(item));
  }

  if (typeof value === 'object') {
    const obj = value as BackupRecord;
    // Check if this is a legacy array serialized as object with numeric keys
    // e.g., {0: "usb", 1: "bluetooth"} should become ["usb", "bluetooth"]
    const keys = Object.keys(obj);
    const isNumericObject = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
    if (isNumericObject) {
      // Convert back to array, sorted by numeric key
      const sortedKeys = keys.map(Number).sort((a, b) => a - b);
      return sortedKeys.map((k) => processValue(obj[k]));
    }

    // Regular object - process recursively
    const processed: BackupRecord = {};
    for (const k of keys) {
      processed[k] = processValue(obj[k]);
    }
    return processed;
  }

  return value;
}

/**
 * Check if a string is an ISO date string
 */
function isISODateString(value: string): boolean {
  // Match ISO 8601 date format
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
  return isoDateRegex.test(value);
}

/**
 * Convert Prisma model name (camelCase) to PostgreSQL table name (snake_case, plural)
 * Prisma uses lowercase plural snake_case for table names by default
 */
export function camelToSnakeCase(modelName: string): string {
  // Special cases mapping
  const specialCases: Record<string, string> = {
    'uTXO': 'utxos',
    'hardwareDeviceModel': 'hardware_device_models',
    'systemSetting': 'system_settings',
    'nodeConfig': 'node_configs',
    'groupMember': 'group_members',
    'pushDevice': 'push_devices',
    'electrumServer': 'electrum_servers',
    'walletUser': 'wallet_users',
    'walletDevice': 'wallet_devices',
    'draftTransaction': 'draft_transactions',
    'draftUtxoLock': 'draft_utxo_locks',
    'transactionInput': 'transaction_inputs',
    'transactionOutput': 'transaction_outputs',
    'transactionLabel': 'transaction_labels',
    'addressLabel': 'address_labels',
    'auditLog': 'audit_logs',
    'mcpApiKey': 'mcp_api_keys',
    'priceData': 'price_data',
    'feeEstimate': 'fee_estimates',
  };

  if (specialCases[modelName]) {
    return specialCases[modelName];
  }

  // Default: convert to snake_case and pluralize
  const snakeCase = modelName
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();

  // Simple pluralization
  if (snakeCase.endsWith('s')) {
    return snakeCase + 'es'; // address -> addresses
  }
  if (snakeCase.endsWith('y')) {
    return snakeCase.slice(0, -1) + 'ies'; // category -> categories
  }
  return snakeCase + 's'; // user -> users, wallet -> wallets
}
