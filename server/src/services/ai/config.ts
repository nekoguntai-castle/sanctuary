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
import { getConfig } from "../../config";
import { getRedisClient, isRedisConnected } from "../../infrastructure/redis";
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
import {
  buildLlmEgressProxyJsonHeaders,
  getLlmEgressProxyServiceSecret,
} from "./llmEgressProxyClient";

const log = createLogger("AI:CONFIG");

// Re-sync config periodically to handle proxy restarts
const CONFIG_RESYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// One llm-egress-proxy serves every process (API replicas and the worker), and
// it holds only the last config it was sent. This process's `configSyncState`
// cannot see pushes from other processes, so the hash the proxy last received
// is also recorded in Redis and a push is skipped only when both agree.
const SHARED_PROXY_CONFIG_HASH_KEY = "ai:llm-egress-proxy:config-hash";
const SHARED_PROXY_CONFIG_HASH_TTL_SEC = 24 * 60 * 60;

/** `undefined` = no shared store (single process); `null` = unknown/missing. */
async function readSharedProxyConfigHash(): Promise<string | null | undefined> {
  const redis = getRedisClient();
  if (!redis) return undefined;
  if (!isRedisConnected()) return null; // unknown: push rather than skip
  try {
    return await redis.get(SHARED_PROXY_CONFIG_HASH_KEY);
  } catch (error) {
    log.warn("Could not read shared LLM egress proxy config marker", {
      error: getErrorMessage(error),
    });
    return null;
  }
}

async function recordSharedProxyConfigHash(hash: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return;
  try {
    await redis.set(SHARED_PROXY_CONFIG_HASH_KEY, hash, "EX", SHARED_PROXY_CONFIG_HASH_TTL_SEC);
  } catch (error) {
    log.warn("Could not record shared LLM egress proxy config marker", {
      error: getErrorMessage(error),
    });
  }
}

let configSyncState: ConfigSyncState = {
  lastHash: "",
  lastSyncTime: 0,
  syncSuccess: false,
};

// Must match PROXY_BOOT_ID_HEADER in llm-egress-proxy/src/bootId.ts (the proxy
// is network-isolated and shares no code with the server).
const PROXY_BOOT_ID_HEADER = "x-sanctuary-proxy-boot-id";
let lastProxyBootId: string | null = null;

/**
 * The proxy stamps every response with an id that changes when it restarts.
 * A new id means the proxy lost its in-memory config, so the cached successful
 * sync is forgotten and the next ensureLlmProxyConfigured pushes again. This
 * covers the routes that answer 200 or 400 while unconfigured.
 */
function observeProxyBootId(response: Response): void {
  const bootId = response.headers?.get(PROXY_BOOT_ID_HEADER);
  if (!bootId) return;
  if (lastProxyBootId !== null && lastProxyBootId !== bootId) {
    log.info("LLM egress proxy restarted; its config will be pushed again");
    configSyncState.syncSuccess = false;
  }
  lastProxyBootId = bootId;
}

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

export interface ConfigSyncResult {
  success: boolean;
  status?: number;
  error?: string;
  reason?: string;
}

export type LlmProxyReadinessResult =
  | { ready: true; config: AIConfig }
  | { ready: false; reason: "provider_not_configured" }
  | {
      ready: false;
      reason: "provider_config_sync_failed";
      syncResult: ConfigSyncResult;
    };

function getStringField(
  value: unknown,
  field: string,
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" && fieldValue.trim()
    ? fieldValue.trim()
    : undefined;
}

async function buildFailedConfigSyncResult(
  response: Response,
): Promise<ConfigSyncResult> {
  const body = await response.json().catch(() => undefined);
  return {
    success: false,
    status: response.status,
    error: getStringField(body, "error") ?? "Failed to sync AI configuration",
    reason: getStringField(body, "reason"),
  };
}

export function describeConfigSyncFailure(result: ConfigSyncResult): string {
  const error = result.error ?? "Failed to sync AI configuration";

  if (result.reason === "host_not_allowed") {
    return `${error}: host_not_allowed. Private LAN IP endpoints are allowed once saved in AI settings, and host.docker.internal reaches the Docker host; public endpoints need HTTPS with LLM_EGRESS_PROXY_ALLOW_PUBLIC_HTTPS=true or an LLM_EGRESS_PROXY_ALLOWED_HOSTS entry.`;
  }

  if (result.reason) {
    return `${error}: ${result.reason}`;
  }

  if (result.status) {
    return `${error} (HTTP ${result.status})`;
  }

  return error;
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

/** System settings that make up the config pushed to the LLM egress proxy. */
export const AI_CONFIG_SETTING_KEYS: readonly string[] = [
  "aiEnabled",
  "aiEndpoint",
  "aiModel",
  AI_PROVIDER_PROFILES_KEY,
  AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
  AI_PROVIDER_CREDENTIALS_KEY,
];

/** A disabled config never carries the credential to the proxy. */
function proxyConfigFor(config: AIConfig): AIConfig {
  return config.enabled ? config : { ...config, apiKey: undefined };
}

/**
 * Get AI configuration from system settings
 */
export async function getAIConfig(): Promise<AIConfig> {
  try {
    const settings = await systemSettingRepository.findByKeys([...AI_CONFIG_SETTING_KEYS]);

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

/** The proxy's 503 replies when it has no provider config (e.g. after a restart). */
async function isProxyUnconfiguredResponse(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  const probe = typeof response.clone === "function" ? response.clone() : response;
  const body: unknown = await probe.json().catch(() => null);
  if (!body || typeof body !== "object") return false;
  const { reason, error } = body as { reason?: unknown; error?: unknown };
  return reason === "provider_not_configured" || error === "AI is not enabled";
}

/**
 * fetch() for calls to the LLM egress proxy. The proxy keeps its provider
 * config in memory and boots disabled, so after a restart it answers "not
 * configured" until the server pushes the config again. That reply forgets the
 * cached successful sync, so the next ensureLlmProxyConfigured re-pushes at
 * once instead of trusting the cache for up to CONFIG_RESYNC_INTERVAL_MS.
 * Other 503s (the upstream provider is down) leave the cache alone.
 */
export async function fetchLlmEgressProxy(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  observeProxyBootId(response);
  if (await isProxyUnconfiguredResponse(response)) {
    configSyncState.syncSuccess = false;
  }
  return response;
}

/**
 * Sync configuration to LLM egress proxy
 * SECURITY: Only syncs when config actually changes (hash-based detection)
 * SECURITY: Requires LLM_EGRESS_PROXY_SECRET for authentication
 */
export async function syncConfigToLlmEgressProxyResult(
  config: AIConfig,
  force = false,
): Promise<ConfigSyncResult> {
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
    const sharedHash = await readSharedProxyConfigHash();
    if (sharedHash === undefined || sharedHash === currentHash) {
      return { success: true };
    }
  }

  // Warn if no secret is configured
  if (!getLlmEgressProxyServiceSecret()) {
    log.warn(
      "LLM_EGRESS_PROXY_SECRET not set - config sync will be rejected by LLM egress proxy",
    );
  }

  try {
    const response = await fetch(`${getLlmEgressProxyUrl()}/config`, {
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

    // Before the state below is written, so a push to a new boot counts.
    observeProxyBootId(response);
    const syncResult = response.ok
      ? { success: true }
      : await buildFailedConfigSyncResult(response);

    // Update sync state
    configSyncState = {
      lastHash: currentHash,
      lastSyncTime: Date.now(),
      syncSuccess: syncResult.success,
    };

    if (!syncResult.success) {
      log.error("Failed to sync config to LLM egress proxy", {
        status: syncResult.status,
        reason: syncResult.reason,
      });
    } else {
      await recordSharedProxyConfigHash(currentHash);
      log.info("AI config synced to LLM egress proxy");
    }

    return syncResult;
  } catch (error) {
    log.error("Failed to sync config to LLM egress proxy", {
      error: getErrorMessage(error),
    });
    configSyncState.syncSuccess = false;
    return {
      success: false,
      error: "Failed to connect to LLM egress proxy for config sync",
    };
  }
}

export async function syncConfigToLlmEgressProxy(
  config: AIConfig,
  force = false,
): Promise<boolean> {
  const result = await syncConfigToLlmEgressProxyResult(config, force);
  return result.success;
}

/**
 * Load the active provider configuration and synchronize it before inference.
 * Callers must not invoke the LLM egress proxy unless this returns ready.
 */
export async function ensureLlmProxyConfigured(
  signal?: AbortSignal,
): Promise<LlmProxyReadinessResult> {
  signal?.throwIfAborted();
  const config = await getAIConfig();
  signal?.throwIfAborted();

  if (!config.enabled || !config.endpoint || !config.model) {
    return { ready: false, reason: "provider_not_configured" };
  }

  const syncResult = await syncConfigToLlmEgressProxyResult(config);
  signal?.throwIfAborted();
  if (!syncResult.success) {
    return {
      ready: false,
      reason: "provider_config_sync_failed",
      syncResult,
    };
  }

  return { ready: true, config };
}

/**
 * Force sync configuration to LLM egress proxy
 * Called when admin updates AI settings (adminSettingsService), so a disable
 * reaches the shared proxy at once and clears the credential it held.
 */
export async function forceSyncConfig(): Promise<boolean> {
  const config = await getAIConfig();
  return syncConfigToLlmEgressProxy(proxyConfigFor(config), true);
}

/**
 * Get the LLM egress proxy URL
 */
export function getLlmEgressProxyUrl(): string {
  return getConfig().ai.llmEgressProxyUrl;
}
