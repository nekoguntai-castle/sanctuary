/**
 * Config Collector
 *
 * Collects application configuration with sensitive values redacted.
 */

import { getConfig } from '../../../config';
import { redactDeep } from '../../../utils/redact';
import { registerCollector } from './registry';

registerCollector('config', async () => {
  const config = getConfig();
  const redacted = redactDeep(config) as unknown as Record<string, unknown>;

  // Extra stripping for connection strings that may slip through
  if (redacted.database && typeof redacted.database === 'object') {
    (redacted.database as Record<string, unknown>).url = '[REDACTED]';
  }
  if (redacted.redis && typeof redacted.redis === 'object') {
    (redacted.redis as Record<string, unknown>).url = '[REDACTED]';
  }

  return redacted;
});
