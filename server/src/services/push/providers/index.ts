/**
 * Push Providers Index
 *
 * Exports all push providers and creates the provider registry.
 */

import { ProviderRegistry } from '../../../providers';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type { IPushProvider, PushPlatform } from '../types';

// Export provider classes
export { BasePushProvider } from './base';
export { APNsPushProvider } from './apns';
export { FCMPushProvider } from './fcm';

// Import providers for registry
import { APNsPushProvider } from './apns';
import { FCMPushProvider } from './fcm';

const log = createLogger('PUSH:SVC_PROVIDERS');

/**
 * Create and configure the push provider registry
 */
export function createPushProviderRegistry(): ProviderRegistry<IPushProvider> {
  const registry = new ProviderRegistry<IPushProvider>({
    name: 'PushProviders',
    healthCheckIntervalMs: 300000, // Check every 5 minutes
    healthCacheTtlMs: 60000, // Cache health for 1 minute
    defaultTimeoutMs: 30000, // 30 second timeout for push sends
    defaultMaxRetries: 1, // Only retry once for push notifications
  });

  return registry;
}

/**
 * Initialize and register all push providers
 */
export async function initializePushProviders(
  registry: ProviderRegistry<IPushProvider>
): Promise<void> {
  const providers: IPushProvider[] = [
    new APNsPushProvider(),
    new FCMPushProvider(),
  ];

  for (const provider of providers) {
    try {
      // Only register if configured
      if (provider.isConfigured()) {
        await registry.register(provider);
        log.info('Registered push provider', { name: provider.name, platform: provider.platform });
      } else {
        log.debug('Push provider not configured, skipping', { name: provider.name });
      }
    } catch (error) {
      log.error('Failed to register push provider', {
        name: provider.name,
        error: getErrorMessage(error),
      });
    }
  }

  // Start periodic health checks
  registry.startHealthChecks();
}

/**
 * Get provider for a specific platform
 */
export function getProviderForPlatform(
  registry: ProviderRegistry<IPushProvider>,
  platform: PushPlatform
): IPushProvider | null {
  for (const provider of registry.getAll()) {
    if (provider.platform === platform) {
      return provider;
    }
  }
  return null;
}

/**
 * Check if any push provider is configured
 */
export function hasConfiguredProviders(
  registry: ProviderRegistry<IPushProvider>
): boolean {
  return registry.getAll().length > 0;
}
