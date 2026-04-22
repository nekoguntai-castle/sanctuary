/**
 * Sensitive Data Redaction Utility
 *
 * Provides utilities for redacting sensitive information from logs,
 * error messages, and API responses to prevent accidental exposure.
 *
 * Usage:
 *   import { redact, redactObject, REDACTED } from '../utils/redact';
 *
 *   // Redact a single value
 *   log.info('Config update', { password: redact(password) });
 *
 *   // Redact sensitive fields from an object
 *   log.info('Request body', redactObject(req.body));
 */

/** Placeholder value for redacted content */
export const REDACTED = '[REDACTED]';

/** Fields that should always be redacted (case-insensitive) */
const SENSITIVE_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'apiSecret',
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

/** Patterns that indicate sensitive data */
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

/**
 * Check if a field name is sensitive
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();

  // Check exact matches
  if (SENSITIVE_FIELDS.has(lowerField)) {
    return true;
  }

  // Check patterns
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * Redact a single value
 *
 * @param value - The value to redact
 * @param showPresence - If true, shows whether value exists (default: true)
 * @returns Redacted string indicating presence or absence
 *
 * @example
 * redact('mypassword');      // '[REDACTED]'
 * redact(null);              // '[NOT SET]'
 * redact('mypassword', false); // '[REDACTED]'
 */
export function redact(value: unknown, showPresence: boolean = true): string {
  if (!showPresence) {
    return REDACTED;
  }

  if (value === null || value === undefined || value === '') {
    return '[NOT SET]';
  }

  return REDACTED;
}

/**
 * Redact sensitive fields from an object (with circular reference handling)
 *
 * @param obj - Object to redact
 * @param additionalFields - Additional field names to redact
 * @returns New object with sensitive fields redacted
 *
 * @example
 * redactObject({ user: 'john', password: 'secret' });
 * // { user: 'john', password: '[REDACTED]' }
 */
export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  additionalFields: string[] = [],
  seen: WeakSet<object> = new WeakSet()
): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // Handle circular references
  if (seen.has(obj)) {
    return { '[Circular]': true };
  }
  seen.add(obj);

  const redactedEntries: Array<[string, unknown]> = [];
  const additionalSet = new Set(additionalFields.map((f) => f.toLowerCase()));

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (isSensitiveField(key) || additionalSet.has(lowerKey)) {
      redactedEntries.push([key, redact(value)]);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively redact nested objects
      redactedEntries.push([
        key,
        redactObject(value as Record<string, unknown>, additionalFields, seen),
      ]);
    } else {
      redactedEntries.push([key, value]);
    }
  }

  // Object.fromEntries keeps keys such as "__proto__" as own data properties.
  return Object.fromEntries(redactedEntries);
}

/**
 * Redact sensitive fields from an object (deep, with circular reference handling)
 *
 * @param obj - Object to deeply redact
 * @param maxDepth - Maximum depth to recurse (default: 5)
 * @returns New object with all sensitive fields redacted at any depth
 */
export function redactDeep<T>(obj: T, maxDepth: number = 5): T {
  const seen = new WeakSet();

  function recurse(value: unknown, depth: number): unknown {
    if (depth > maxDepth) {
      return '[MAX DEPTH]';
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'object') {
      return value;
    }

    // Handle circular references
    if (seen.has(value as object)) {
      return '[CIRCULAR]';
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => recurse(item, depth + 1));
    }

    const redactedEntries: Array<[string, unknown]> = [];
    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveField(key)) {
        redactedEntries.push([key, redact(val)]);
      } else {
        redactedEntries.push([key, recurse(val, depth + 1)]);
      }
    }

    // Object.fromEntries keeps keys such as "__proto__" as own data properties.
    return Object.fromEntries(redactedEntries);
  }

  return recurse(obj, 0) as T;
}

/**
 * Create a safe error object for logging
 * Extracts message and stack but redacts any sensitive data
 *
 * @param error - Error to make safe for logging
 * @returns Object with error details safe for logging
 */
export function safeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  return { message: String(error) };
}

/**
 * Mask a string, showing only first and last N characters
 *
 * @param value - String to mask
 * @param visibleChars - Number of characters to show at start and end (default: 4)
 * @returns Masked string
 *
 * @example
 * mask('sk_live_abc123xyz789'); // 'sk_l***9789'
 */
export function mask(value: string, visibleChars: number = 4): string {
  if (!value || value.length <= visibleChars * 2) {
    return REDACTED;
  }

  const start = value.substring(0, visibleChars);
  const end = value.substring(value.length - visibleChars);
  return `${start}***${end}`;
}

export default {
  redact,
  redactObject,
  redactDeep,
  safeError,
  mask,
  REDACTED,
};
