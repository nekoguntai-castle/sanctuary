/**
 * Shared redaction helpers for log metadata.
 *
 * Keep this package-local and dependency-free so gateway, server, and scripts can
 * use the same field rules without pulling in framework-specific code.
 */

import { WEBHOOK_REDACTED_VALUE } from '../constants/webhooks';

export const REDACTED = '[REDACTED]';
export const NOT_SET = '[NOT SET]';
export const CIRCULAR = '[CIRCULAR]';
export const MAX_DEPTH = '[MAX DEPTH]';

const SENSITIVE_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'apisecret',
  'api_secret',
  'privatekey',
  'private_key',
  'encryptionkey',
  'encryption_key',
  'jwt',
  'bearer',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'xpub',
  'xprv',
  'seed',
  'mnemonic',
  'passphrase',
  'pin',
  'otp',
  'totp',
  'backupcode',
  'backup_code',
  'recoverycode',
  'recovery_code',
]);

const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /encryption[_-]?key/i,
  /credential/i,
  /mnemonic/i,
  /seed/i,
  /xprv/i,
];

export function isSensitiveField(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();
  return SENSITIVE_FIELDS.has(lowerField) || SENSITIVE_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * Replace a sensitive value while optionally preserving whether it was set.
 */
export function redact(value: unknown, showPresence = true): string {
  if (!showPresence) {
    return REDACTED;
  }

  if (value === null || value === undefined || value === '') {
    return NOT_SET;
  }

  return REDACTED;
}

/**
 * Clone log metadata into a JSON-safe value while redacting sensitive keys.
 *
 * Traversal is bounded by maxDepth and circular references are replaced with a
 * marker so logging cannot throw on common metadata shapes.
 */
export function redactDeep<T>(input: T, maxDepth = 6): T {
  const seen = new WeakSet<object>();

  function recurse(value: unknown, depth: number): unknown {
    if (depth > maxDepth) {
      return MAX_DEPTH;
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'function') {
      return '[FUNCTION]';
    }

    if (typeof value === 'symbol') {
      return String(value);
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
      };
    }

    if (Array.isArray(value)) {
      return value.map((item) => recurse(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = isSensitiveField(key) ? redact(nestedValue) : recurse(nestedValue, depth + 1);
    }
    return result;
  }

  return recurse(input, 0) as T;
}

/**
 * Clone request metadata while replacing every configured webhook header value.
 * Header names are retained for diagnostics, but values are secret regardless
 * of whether their names look credential-like.
 */
export function redactWebhookHeaderConfigValues<T>(input: T): T {
  const seen = new WeakSet<object>();

  function recurse(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);

    if (Array.isArray(value)) return value.map(recurse);

    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
      if (key !== 'headerConfig') {
        return [key, recurse(nestedValue)];
      }
      if (!isRecord(nestedValue)) return [key, WEBHOOK_REDACTED_VALUE];

      const headerConfig = Object.fromEntries(Object.entries(nestedValue).map(
        ([configKey, configValue]) => configKey === 'headers'
          ? [configKey, redactConfiguredHeaderMap(configValue)]
          : [configKey, recurse(configValue)],
      ));
      return [key, headerConfig];
    }));
  }

  return recurse(input) as T;
}

function redactConfiguredHeaderMap(value: unknown): unknown {
  if (!isRecord(value)) return WEBHOOK_REDACTED_VALUE;
  return Object.fromEntries(
    Object.keys(value).map(key => [key, WEBHOOK_REDACTED_VALUE]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Serialize log metadata after safe traversal and sensitive-field redaction.
 */
export function stringifyRedacted(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(redactDeep(input));
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
    });
  }
}
