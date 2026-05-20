/**
 * AI Features
 *
 * AI-powered features: label suggestions, natural language queries,
 * provider detection, and provider model listing.
 *
 * DATA FLOW:
 * 1. User requests AI feature (suggest label, NL query)
 * 2. Backend forwards to LLM egress proxy
 * 3. LLM egress proxy fetches sanitized data via /internal/ai/* endpoints
 * 4. LLM egress proxy calls external AI
 * 5. LLM egress proxy returns suggestion
 * 6. Backend returns to user (suggestions only - user must confirm)
 */

import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import {
  describeConfigSyncFailure,
  getAIConfig,
  syncConfigToLlmEgressProxy,
  syncConfigToLlmEgressProxyResult,
  getLlmEgressProxyUrl,
} from "./config";
import { validateResponse } from "./validation";
import {
  buildLlmEgressProxyAuthHeaders,
  buildLlmEgressProxyJsonHeaders,
} from "./llmEgressProxyClient";
import type {
  QueryResult,
  AISuggestLabelResponse,
  AIQueryResponse,
  AIDetectOllamaResponse,
  AIDetectProviderResponse,
  AIListModelsResponse,
} from "./types";
import type { AIProviderType } from "./providerProfile";

const log = createLogger("AI:SVC");

const LLM_EGRESS_PROXY_URL = getLlmEgressProxyUrl();
const AI_NATURAL_QUERY_TIMEOUT_MS = 125_000;
/**
 * Suggest a transaction label
 *
 * Forwards request to LLM egress proxy, which:
 * 1. Fetches sanitized tx data from /internal/ai/tx/:id
 * 2. Calls external AI
 * 3. Returns suggestion
 */
export async function suggestTransactionLabel(
  transactionId: string,
  authToken: string,
): Promise<string | null> {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return null;
  }

  // Sync config to LLM egress proxy
  await syncConfigToLlmEgressProxy(config);

  try {
    const response = await fetch(`${LLM_EGRESS_PROXY_URL}/suggest-label`, {
      method: "POST",
      headers: buildLlmEgressProxyJsonHeaders({
        authorization: `Bearer ${authToken}`,
      }),
      body: JSON.stringify({ transactionId }),
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => {
        log.warn("Failed to parse error response JSON for label suggestion");
        return {};
      });
      const error = validateResponse<{ error?: string }>(errorJson, []);
      log.error("AI label suggestion failed", {
        status: response.status,
        error: error?.error,
      });
      return null;
    }

    const json = await response.json();
    const result = validateResponse<AISuggestLabelResponse>(json, [
      "suggestion",
    ]);

    if (!result) {
      log.error("Invalid response from LLM egress proxy for label suggestion");
      return null;
    }

    return result.suggestion || null;
  } catch (error) {
    log.error("AI label suggestion error", { error: getErrorMessage(error) });
    return null;
  }
}

/**
 * Execute a natural language query
 *
 * Forwards request to LLM egress proxy, which returns a structured query.
 * Backend then executes the query against the database.
 */
export async function executeNaturalQuery(
  query: string,
  walletId: string,
  authToken: string,
): Promise<QueryResult | null> {
  const config = await getAIConfig();

  if (!config.enabled || !config.endpoint || !config.model) {
    return null;
  }

  // Sync config to LLM egress proxy
  await syncConfigToLlmEgressProxy(config);

  try {
    const response = await fetch(`${LLM_EGRESS_PROXY_URL}/query`, {
      method: "POST",
      headers: buildLlmEgressProxyJsonHeaders({
        authorization: `Bearer ${authToken}`,
      }),
      body: JSON.stringify({ query, walletId }),
      signal: AbortSignal.timeout(AI_NATURAL_QUERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => {
        log.warn("Failed to parse error response JSON for query");
        return {};
      });
      const error = validateResponse<{ error?: string }>(errorJson, []);
      log.error("AI query failed", {
        status: response.status,
        error: error?.error,
      });
      return null;
    }

    const json = await response.json();
    const result = validateResponse<AIQueryResponse>(json, ["query"]);

    if (!result) {
      log.error("Invalid response from LLM egress proxy for query");
      return null;
    }

    return result.query || null;
  } catch (error) {
    log.error("AI query error", { error: getErrorMessage(error) });
    return null;
  }
}

/**
 * Detect Ollama at common endpoints
 */
export async function detectOllama(): Promise<{
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}> {
  try {
    const response = await fetch(`${LLM_EGRESS_PROXY_URL}/detect-ollama`, {
      method: "POST",
      headers: buildLlmEgressProxyJsonHeaders(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { found: false, message: "Detection failed" };
    }

    const json = await response.json();
    const result = validateResponse<AIDetectOllamaResponse>(json, ["found"]);

    if (!result) {
      log.error("Invalid response from LLM egress proxy for Ollama detection");
      return { found: false, message: "Invalid response format" };
    }

    return result;
  } catch (error) {
    log.error("Ollama detection error", { error: getErrorMessage(error) });
    return { found: false, message: "LLM egress proxy not available" };
  }
}

/**
 * Detect a supported provider at an operator-supplied endpoint.
 */
export async function detectProviderEndpoint(input: {
  endpoint: string;
  preferredProviderType?: AIProviderType;
  apiKey?: string;
}): Promise<AIDetectProviderResponse> {
  try {
    const response = await fetch(`${LLM_EGRESS_PROXY_URL}/detect-provider`, {
      method: "POST",
      headers: buildLlmEgressProxyJsonHeaders(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15000),
    });

    const json = await response.json().catch(() => ({}));
    const result = validateResponse<AIDetectProviderResponse>(json, ["found"]);

    if (result) {
      return result;
    }

    return {
      found: false,
      message:
        response.ok ? "Invalid response format" : "Provider detection failed",
    };
  } catch (error) {
    log.error("AI provider endpoint detection error", {
      error: getErrorMessage(error),
    });
    return { found: false, message: "LLM egress proxy not available" };
  }
}

/**
 * List available models from configured endpoint
 */
export async function listModels(): Promise<{
  models: Array<{ name: string; size: number; modifiedAt: string }>;
  error?: string;
}> {
  const config = await getAIConfig();

  if (!config.endpoint) {
    return { models: [], error: "No AI endpoint configured" };
  }

  // Sync config first so the LLM egress proxy knows the endpoint.
  const syncResult = await syncConfigToLlmEgressProxyResult(config);
  if (!syncResult.success) {
    return { models: [], error: describeConfigSyncFailure(syncResult) };
  }

  try {
    const response = await fetch(`${LLM_EGRESS_PROXY_URL}/list-models`, {
      method: "GET",
      headers: buildLlmEgressProxyAuthHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => {
        log.warn("Failed to parse error response JSON for list models");
        return {};
      });
      const error = validateResponse<{ error?: string }>(errorJson, []);
      return { models: [], error: error?.error || "Failed to list models" };
    }

    const json = await response.json();
    const result = validateResponse<AIListModelsResponse>(json, ["models"]);

    if (!result) {
      log.error("Invalid response from LLM egress proxy for list models");
      return { models: [], error: "Invalid response format" };
    }

    return result;
  } catch (error) {
    log.error("List models error", { error: getErrorMessage(error) });
    return { models: [], error: "Cannot connect to LLM egress proxy" };
  }
}
