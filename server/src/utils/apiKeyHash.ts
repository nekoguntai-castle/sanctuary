import crypto from 'node:crypto';
import config from '../config';

const API_KEY_HASH_VERSION = 'sanctuary-api-key-lookup-hmac-sha256-v1';

function getApiKeyHashSecret(): string {
  /* v8 ignore next -- fallback is for deployments without ENCRYPTION_KEY; tests use the primary path. */
  const secret = config.security.encryptionKey || config.security.jwt.secret;
  /* v8 ignore next -- startup config validation provides at least one API-key hash secret. */
  if (!secret) {
    throw new Error('API key hash secret is not configured');
  }
  return secret;
}

/**
 * Hash a newly-created high-entropy API key for database lookup.
 *
 * The namespace is part of the HMAC input so MCP keys and agent keys do not
 * share the same lookup digest if identical token material were ever issued.
 * Existing database rows created before this helper are checked with
 * `hashLegacyApiKeyLookup`; new rows should use this function.
 */
export function hashApiKeyLookup(apiKey: string, namespace: string): string {
  return crypto
    .createHmac('sha256', getApiKeyHashSecret())
    .update(API_KEY_HASH_VERSION, 'utf8')
    .update('\0')
    .update(namespace, 'utf8')
    .update('\0')
    .update(apiKey, 'utf8')
    .digest('hex');
}

/**
 * Compute the pre-HMAC API-key lookup digest for backward compatibility only.
 *
 * This is not used for newly-created keys. It lets existing MCP and agent
 * clients continue to authenticate until their keys are rotated naturally.
 * The input is generated high-entropy token material, not a human password.
 */
export function hashLegacyApiKeyLookup(legacyHighEntropyToken: string): string {
  return crypto.hash('sha256', legacyHighEntropyToken, 'hex');
}
