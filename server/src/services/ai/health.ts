/**
 * AI Health Check
 *
 * Health check and availability functions for the AI service.
 */

import { createLogger } from "../../utils/logger";
import {
  describeConfigSyncFailure,
  getAIConfig,
  getLlmEgressProxyUrl,
  syncConfigToLlmEgressProxyResult,
} from "./config";
import { buildLlmEgressProxyJsonHeaders } from "./llmEgressProxyClient";
import { validateResponse } from "./validation";
import type { AIHealthResponse } from "./types";

const log = createLogger("AI:SVC_HEALTH");
const LLM_EGRESS_PROXY_URL = getLlmEgressProxyUrl();

/**
 * Get the persisted AI assistant setup state without probing provider health.
 */
export async function getConfigStatus(): Promise<{
  enabled: boolean;
  configured: boolean;
  model?: string;
  endpoint?: string;
}> {
  const config = await getAIConfig();

  return {
    enabled: config.enabled,
    configured: Boolean(config.endpoint && config.model),
    model: config.model || undefined,
    endpoint: config.endpoint || undefined,
  };
}

/**
 * Check if AI is enabled in settings
 */
export async function isEnabled(): Promise<boolean> {
  const status = await getConfigStatus();
  return status.enabled && status.configured;
}

/**
 * Check if LLM egress proxy is available
 */
export async function isLlmEgressProxyAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${LLM_EGRESS_PROXY_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (error) {
    log.debug("LLM egress proxy health check failed", { error: String(error) });
    return false;
  }
}

/**
 * Check AI endpoint health
 */
export async function checkHealth(): Promise<{
  available: boolean;
  model?: string;
  endpoint?: string;
  proxyAvailable?: boolean;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.enabled) {
    return {
      available: false,
      error: "AI is disabled in settings",
    };
  }

  if (!config.endpoint || !config.model) {
    return {
      available: false,
      error: "AI endpoint or model not configured",
    };
  }

  // Check if LLM egress proxy is available
  const proxyAvailable = await isLlmEgressProxyAvailable();
  if (!proxyAvailable) {
    return {
      available: false,
      model: config.model,
      endpoint: config.endpoint,
      proxyAvailable: false,
      error: "LLM egress proxy is not available",
    };
  }

  // Sync config and test connection
  const syncResult = await syncConfigToLlmEgressProxyResult(config);
  if (!syncResult.success) {
    return {
      available: false,
      model: config.model,
      endpoint: config.endpoint,
      proxyAvailable: true,
      error: describeConfigSyncFailure(syncResult),
    };
  }

  try {
    const response = await fetch(`${LLM_EGRESS_PROXY_URL}/test`, {
      method: "POST",
      headers: buildLlmEgressProxyJsonHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return {
        available: false,
        model: config.model,
        endpoint: config.endpoint,
        proxyAvailable: true,
        error: "LLM egress proxy test failed",
      };
    }

    const json = await response.json();
    const result = validateResponse<AIHealthResponse>(json, ["available"]);

    if (!result) {
      return {
        available: false,
        model: config.model,
        endpoint: config.endpoint,
        proxyAvailable: true,
        error: "Invalid response from LLM egress proxy",
      };
    }

    return {
      available: result.available,
      model: config.model,
      endpoint: config.endpoint,
      proxyAvailable: true,
      error: result.error,
    };
  } catch (error) {
    return {
      available: false,
      model: config.model,
      endpoint: config.endpoint,
      proxyAvailable: true,
      error: "Failed to test AI connection",
    };
  }
}
