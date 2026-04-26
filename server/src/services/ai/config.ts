/**
 * AI Configuration and Sync
 *
 * Manages AI configuration from system settings and syncs it
 * to the AI container with hash-based change detection.
 *
 * SECURITY: Only syncs when config actually changes (hash-based detection)
 * SECURITY: Requires AI_CONFIG_SECRET for authentication
 */

import { systemSettingRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { safeJsonParse, safeJsonParseUntyped, SystemSettingSchemas } from '../../utils/safeJson';
import { createHash } from 'crypto';
import type { AIConfig, ConfigSyncState } from './types';
import {
  AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
  AI_PROVIDER_PROFILES_KEY,
  buildAIProviderProfileState,
} from './providerProfile';

const log = createLogger('AI:CONFIG');

// AI container URL
const AI_CONTAINER_URL = process.env.AI_CONTAINER_URL || 'http://ai:3100';

// AI config secret for authenticating with container
const AI_CONFIG_SECRET = process.env.AI_CONFIG_SECRET || '';

// Re-sync config periodically to handle container restarts
const CONFIG_RESYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let configSyncState: ConfigSyncState = {
  lastHash: '',
  lastSyncTime: 0,
  syncSuccess: false,
};

/**
 * Generate a hash of the config for change detection
 */
function hashConfig(config: AIConfig): string {
  const data = JSON.stringify({
    enabled: config.enabled,
    endpoint: config.endpoint,
    model: config.model,
    providerProfileId: config.providerProfileId,
    providerType: config.providerType,
  });
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Get AI configuration from system settings
 */
export async function getAIConfig(): Promise<AIConfig> {
  try {
    const settings = await systemSettingRepository.findByKeys([
      'aiEnabled',
      'aiEndpoint',
      'aiModel',
      AI_PROVIDER_PROFILES_KEY,
      AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
    ]);

    let enabled = false;
    let endpoint = '';
    let model = '';
    let providerProfiles: unknown;
    let activeProviderProfileId = '';

    for (const setting of settings) {
      const key = setting.key;
      if (key === 'aiEnabled') {
        enabled = safeJsonParse(setting.value, SystemSettingSchemas.boolean, false, 'aiEnabled');
      } else if (key === 'aiEndpoint') {
        endpoint = safeJsonParse(setting.value, SystemSettingSchemas.string, '', 'aiEndpoint');
      } else if (key === 'aiModel') {
        model = safeJsonParse(setting.value, SystemSettingSchemas.string, '', 'aiModel');
      } else if (key === AI_PROVIDER_PROFILES_KEY) {
        providerProfiles = safeJsonParseUntyped<unknown>(setting.value, undefined, AI_PROVIDER_PROFILES_KEY);
      } else if (key === AI_ACTIVE_PROVIDER_PROFILE_ID_KEY) {
        activeProviderProfileId = safeJsonParse(
          setting.value,
          SystemSettingSchemas.string,
          '',
          AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
        );
      }
    }

    const providerState = buildAIProviderProfileState({
      endpoint,
      model,
      providerProfiles,
      activeProviderProfileId,
    });

    return {
      enabled,
      endpoint: providerState.aiActiveProviderProfile.endpoint,
      model: providerState.aiActiveProviderProfile.model,
      providerProfileId: providerState.aiActiveProviderProfile.id,
      providerType: providerState.aiActiveProviderProfile.providerType,
    };
  } catch (error) {
    log.error('Failed to get AI config', { error: getErrorMessage(error) });
    return {
      enabled: false,
      endpoint: '',
      model: '',
    };
  }
}

/**
 * Sync configuration to AI container
 * SECURITY: Only syncs when config actually changes (hash-based detection)
 * SECURITY: Requires AI_CONFIG_SECRET for authentication
 */
export async function syncConfigToContainer(config: AIConfig, force = false): Promise<boolean> {
  const currentHash = hashConfig(config);
  const timeSinceLastSync = Date.now() - configSyncState.lastSyncTime;

  // Skip sync if config hasn't changed, last sync was successful, and within resync interval
  // This ensures we re-sync periodically to handle AI container restarts
  if (!force && configSyncState.lastHash === currentHash && configSyncState.syncSuccess && timeSinceLastSync < CONFIG_RESYNC_INTERVAL_MS) {
    return true;
  }

  // Warn if no secret is configured
  if (!AI_CONFIG_SECRET) {
    log.warn('AI_CONFIG_SECRET not set - config sync will be rejected by container');
  }

  try {
    const response = await fetch(`${AI_CONTAINER_URL}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AI-Config-Secret': AI_CONFIG_SECRET,
      },
      body: JSON.stringify({
        enabled: config.enabled,
        endpoint: config.endpoint,
        model: config.model,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const success = response.ok;

    // Update sync state
    configSyncState = {
      lastHash: currentHash,
      lastSyncTime: Date.now(),
      syncSuccess: success,
    };

    if (!success) {
      log.error('Failed to sync config to AI container', { status: response.status });
    } else {
      log.info('AI config synced to container');
    }

    return success;
  } catch (error) {
    log.error('Failed to sync config to AI container', { error: getErrorMessage(error) });
    configSyncState.syncSuccess = false;
    return false;
  }
}

/**
 * Force sync configuration to AI container
 * Called when admin updates AI settings
 */
export async function forceSyncConfig(): Promise<boolean> {
  const config = await getAIConfig();
  return syncConfigToContainer(config, true);
}

/**
 * Get the AI container URL
 */
export function getContainerUrl(): string {
  return AI_CONTAINER_URL;
}
