/**
 * AI Configuration and Sync
 *
 * Manages AI configuration from system settings and syncs it
 * to the LLM egress proxy with hash-based change detection.
 *
 * SECURITY: Only syncs when config actually changes (hash-based detection)
 * SECURITY: Requires LLM_EGRESS_PROXY_SECRET for authentication
 */

import { systemSettingRepository } from "../../repositories";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import {
  safeJsonParse,
  safeJsonParseUntyped,
  SystemSettingSchemas,
} from "../../utils/safeJson";
import { createHash } from "crypto";
import { decrypt } from "../../utils/encryption";
import type { AIConfig, ConfigSyncState } from "./types";
import {
  AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
  AI_PROVIDER_PROFILES_KEY,
  buildAIProviderProfileState,
} from "./providerProfile";
import {
  AI_PROVIDER_CREDENTIALS_KEY,
  parseAIProviderCredentials,
} from "./providerCredentials";
import { buildLlmEgressProxyJsonHeaders } from "./llmEgressProxyClient";

const log = createLogger("AI:CONFIG");

// LLM egress proxy URL
const LLM_EGRESS_PROXY_URL =
  process.env.LLM_EGRESS_PROXY_URL || "http://llm-egress-proxy:3100";

// Re-sync config periodically to handle proxy restarts
const CONFIG_RESYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let configSyncState: ConfigSyncState = {
  lastHash: "",
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
    credentialConfigured: Boolean(config.apiKey),
    credentialConfiguredAt: config.credentialConfiguredAt ?? "",
  });
  return createHash("sha256").update(data).digest("hex");
}

interface ActiveProviderCredentialSyncState {
  apiKey?: string;
  credentialConfiguredAt?: string;
}

function getActiveProviderCredentialSyncState(
  credentialsValue: unknown,
  profileId: string,
): ActiveProviderCredentialSyncState {
  const credentials = parseAIProviderCredentials(credentialsValue);
  const credential = credentials[profileId];

  if (!credential?.encryptedApiKey || credential.disabledReason) {
    return {};
  }

  try {
    return {
      apiKey: decrypt(credential.encryptedApiKey),
      credentialConfiguredAt: credential.configuredAt,
    };
  } catch (error) {
    // Fail closed: keep the proxy credential-free when stored encrypted
    // material cannot be decrypted, and log only metadata.
    log.warn("Failed to decrypt AI provider credential", {
      providerProfileId: profileId,
      error: getErrorMessage(error),
    });
    return {};
  }
}

/**
 * Get AI configuration from system settings
 */
export async function getAIConfig(): Promise<AIConfig> {
  try {
    const settings = await systemSettingRepository.findByKeys([
      "aiEnabled",
      "aiEndpoint",
      "aiModel",
      AI_PROVIDER_PROFILES_KEY,
      AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
      AI_PROVIDER_CREDENTIALS_KEY,
    ]);

    let enabled = false;
    let endpoint = "";
    let model = "";
    let providerProfiles: unknown;
    let activeProviderProfileId = "";
    let providerCredentials: unknown;

    for (const setting of settings) {
      const key = setting.key;
      if (key === "aiEnabled") {
        enabled = safeJsonParse(
          setting.value,
          SystemSettingSchemas.boolean,
          false,
          "aiEnabled",
        );
      } else if (key === "aiEndpoint") {
        endpoint = safeJsonParse(
          setting.value,
          SystemSettingSchemas.string,
          "",
          "aiEndpoint",
        );
      } else if (key === "aiModel") {
        model = safeJsonParse(
          setting.value,
          SystemSettingSchemas.string,
          "",
          "aiModel",
        );
      } else if (key === AI_PROVIDER_PROFILES_KEY) {
        providerProfiles = safeJsonParseUntyped<unknown>(
          setting.value,
          undefined,
          AI_PROVIDER_PROFILES_KEY,
        );
      } else if (key === AI_ACTIVE_PROVIDER_PROFILE_ID_KEY) {
        activeProviderProfileId = safeJsonParse(
          setting.value,
          SystemSettingSchemas.string,
          "",
          AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
        );
      } else if (key === AI_PROVIDER_CREDENTIALS_KEY) {
        providerCredentials = safeJsonParseUntyped<unknown>(
          setting.value,
          undefined,
          AI_PROVIDER_CREDENTIALS_KEY,
        );
      }
    }

    const providerState = buildAIProviderProfileState({
      endpoint,
      model,
      providerProfiles,
      activeProviderProfileId,
    });

    const activeCredential = getActiveProviderCredentialSyncState(
      providerCredentials,
      providerState.aiActiveProviderProfile.id,
    );

    return {
      enabled,
      endpoint: providerState.aiActiveProviderProfile.endpoint,
      model: providerState.aiActiveProviderProfile.model,
      providerProfileId: providerState.aiActiveProviderProfile.id,
      providerType: providerState.aiActiveProviderProfile.providerType,
      apiKey: activeCredential.apiKey,
      credentialConfiguredAt: activeCredential.credentialConfiguredAt,
    };
  } catch (error) {
    log.error("Failed to get AI config", { error: getErrorMessage(error) });
    return {
      enabled: false,
      endpoint: "",
      model: "",
    };
  }
}

/**
 * Sync configuration to LLM egress proxy
 * SECURITY: Only syncs when config actually changes (hash-based detection)
 * SECURITY: Requires LLM_EGRESS_PROXY_SECRET for authentication
 */
export async function syncConfigToLlmEgressProxy(
  config: AIConfig,
  force = false,
): Promise<boolean> {
  const currentHash = hashConfig(config);
  const timeSinceLastSync = Date.now() - configSyncState.lastSyncTime;

  // Skip sync if config hasn't changed, last sync was successful, and within resync interval
  // This ensures we re-sync periodically to handle LLM egress proxy restarts
  if (
    !force &&
    configSyncState.lastHash === currentHash &&
    configSyncState.syncSuccess &&
    timeSinceLastSync < CONFIG_RESYNC_INTERVAL_MS
  ) {
    return true;
  }

  // Warn if no secret is configured
  if (!process.env.LLM_EGRESS_PROXY_SECRET) {
    log.warn(
      "LLM_EGRESS_PROXY_SECRET not set - config sync will be rejected by LLM egress proxy",
    );
  }

  try {
    const response = await fetch(`${LLM_EGRESS_PROXY_URL}/config`, {
      method: "POST",
      headers: buildLlmEgressProxyJsonHeaders({ includeConfigSecret: true }),
      body: JSON.stringify({
        enabled: config.enabled,
        endpoint: config.endpoint,
        model: config.model,
        providerProfileId: config.providerProfileId,
        providerType: config.providerType,
        apiKey: config.apiKey ?? "",
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
      log.error("Failed to sync config to LLM egress proxy", {
        status: response.status,
      });
    } else {
      log.info("AI config synced to LLM egress proxy");
    }

    return success;
  } catch (error) {
    log.error("Failed to sync config to LLM egress proxy", {
      error: getErrorMessage(error),
    });
    configSyncState.syncSuccess = false;
    return false;
  }
}

/**
 * Force sync configuration to LLM egress proxy
 * Called when admin updates AI settings
 */
export async function forceSyncConfig(): Promise<boolean> {
  const config = await getAIConfig();
  return syncConfigToLlmEgressProxy(config, true);
}

/**
 * Get the LLM egress proxy URL
 */
export function getLlmEgressProxyUrl(): string {
  return LLM_EGRESS_PROXY_URL;
}
