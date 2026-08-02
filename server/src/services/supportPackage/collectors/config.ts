/**
 * Safe Config Collector
 *
 * Exposes only reviewed, non-secret facts needed to diagnose the notification
 * pipeline. Raw configuration objects must never cross the support-package
 * boundary, even after generic redaction.
 */

import { getConfig } from '../../../config';
import { registerShareableCollector } from './registry';
import { safeConfigProfileSchema } from './configSafeSchema';

const collectSafeConfig = async () => {
  const config = getConfig();

  return safeConfigProfileSchema.parse({
    environment: config.server.nodeEnv,
    bitcoinNetwork: config.bitcoin.network,
    notificationPipeline: {
      databaseConfigured: Boolean(config.database.url),
      redisConfigured: config.redis.enabled,
      workerHealthConfigured: Boolean(config.worker.healthUrl),
      electrumSubscriptionsEnabled: config.sync.electrumSubscriptionsEnabled,
      telegramFeatureDefaultEnabled: config.features.telegramNotifications,
    },
  });
};

registerShareableCollector('config', {
  collect: collectSafeConfig,
  schema: safeConfigProfileSchema,
  sourceProcess: 'api',
  sourceKind: 'static_configuration',
  authoritativeFor: ['static_notification_configuration'],
  notAuthoritativeFor: ['effective_notification_configuration', 'worker_delivery'],
});
