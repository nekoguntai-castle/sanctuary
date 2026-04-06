/**
 * Config Collector
 *
 * Collects application configuration with sensitive values redacted.
 * Feature flags are overlaid from the database to reflect runtime state,
 * not just the static environment defaults.
 */

import { getConfig } from '../../../config';
import { redactDeep } from '../../../utils/redact';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { featureFlagService } from '../../../services/featureFlagService';
import { registerCollector } from './registry';

const log = createLogger('SUPPORT:CONFIG');

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

  // Overlay runtime feature flags from database over static config defaults
  // so the support file reflects what the UI actually shows
  try {
    const runtimeFlags = await featureFlagService.getAllFlags();
    if (runtimeFlags?.length && redacted.features && typeof redacted.features === 'object') {
      const features = redacted.features as Record<string, unknown>;
      for (const flag of runtimeFlags) {
        if (flag.key.startsWith('experimental.')) {
          const expKey = flag.key.replace('experimental.', '');
          if (features.experimental && typeof features.experimental === 'object') {
            (features.experimental as Record<string, unknown>)[expKey] = flag.enabled;
          }
        } else {
          features[flag.key] = flag.enabled;
        }
      }
    }
  } catch (error) {
    log.debug('Feature flag service unavailable, using static config defaults', { error: getErrorMessage(error) });
  }

  return redacted;
});
