/**
 * Safe JSON Parsing Utilities
 *
 * Provides type-safe JSON parsing with Zod schema validation and proper error logging.
 * Prevents silent failures and unsafe type assertions.
 */

import { z } from 'zod';
import { createLogger } from './logger';
import { getErrorMessage } from './errors';

const log = createLogger('UTIL:SAFE_JSON');

/**
 * Safely parse a JSON string with Zod schema validation.
 * Returns the default value on any error (parse or validation) and logs the issue.
 *
 * @param value - The JSON string to parse
 * @param schema - Zod schema to validate the parsed value
 * @param defaultValue - Value to return on error
 * @param context - Optional context for logging (e.g., "registrationEnabled setting")
 * @returns The parsed and validated value, or the default value on error
 *
 * @example
 * const enabled = safeJsonParse(setting.value, z.boolean(), false, 'registrationEnabled');
 * const config = safeJsonParse(jsonStr, ConfigSchema, defaultConfig, 'rate limit config');
 */
export function safeJsonParse<T>(
  value: string | null | undefined,
  schema: z.ZodType<T>,
  defaultValue: T,
  context?: string
): T {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  try {
    const parsed = JSON.parse(value);
    const result = schema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    log.warn('JSON validation failed', {
      context,
      errors: result.error.issues.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
      valuePreview: value.substring(0, 100),
    });
    return defaultValue;
  } catch (error) {
    log.warn('JSON parse failed', {
      context,
      error: getErrorMessage(error, 'Unknown error'),
      valuePreview: value.substring(0, 100),
    });
    return defaultValue;
  }
}

/**
 * Safely parse a JSON string and return it with type assertion.
 * Use this only when you need flexibility and can't use a Zod schema.
 * Logs errors but returns the default value silently.
 *
 * @param value - The JSON string to parse
 * @param defaultValue - Value to return on error
 * @param context - Optional context for logging
 * @returns The parsed value or the default value on error
 *
 * @example
 * const data = safeJsonParseUntyped<MyType>(jsonStr, {}, 'my config');
 */
export function safeJsonParseUntyped<T>(
  value: string | null | undefined,
  defaultValue: T,
  context?: string
): T {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    log.warn('JSON parse failed', {
      context,
      error: getErrorMessage(error, 'Unknown error'),
      valuePreview: value.substring(0, 100),
    });
    return defaultValue;
  }
}

/**
 * Parse schema-validated JSON without logging any part of the input. Use this
 * for secrets or privacy-sensitive protocol payloads where even an error
 * preview would cross the logging boundary.
 */
export function safeJsonParseSensitive<T>(
  value: string,
  schema: z.ZodType<T>,
): T | undefined {
  try {
    const result = schema.safeParse(JSON.parse(value));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Common Zod schemas for system settings
 */
export const SystemSettingSchemas = {
  boolean: z.boolean(),
  number: z.number(),
  string: z.string(),
  stringArray: z.array(z.string()),
  numberArray: z.array(z.number()),
};
