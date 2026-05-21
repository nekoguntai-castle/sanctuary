/**
 * AI API
 *
 * API calls for AI-powered features (transaction labeling, natural language queries)
 */

import apiClient, { ApiError } from "./client";
import type { AIProviderType } from "./admin/types";

const AI_NATURAL_QUERY_TIMEOUT_MS = 120_000;

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface AIStatus {
  enabled?: boolean;
  configured?: boolean;
  available: boolean;
  model?: string;
  endpoint?: string;
  error?: string;
  message?: string;
  proxyAvailable?: boolean;
}

export interface SuggestLabelRequest {
  transactionId: string;
}

export interface SuggestLabelResponse {
  suggestion: string;
}

export interface NaturalQueryRequest {
  query: string;
  walletId: string;
}

export interface NaturalQueryResult {
  type: "transactions" | "addresses" | "utxos" | "summary";
  filter?: Record<string, any> | null;
  sort?: {
    field: string;
    order: "asc" | "desc";
  } | null;
  limit?: number | null;
  aggregation?: "sum" | "count" | "max" | "min" | null;
}

// ========================================
// API FUNCTIONS
// ========================================

/**
 * Check AI availability and status
 */
export async function getAIStatus(): Promise<AIStatus> {
  return apiClient.get<AIStatus>("/ai/status");
}

/**
 * Explicitly test the configured AI provider connection.
 * This may perform a small model request and is only used by admin setup UI.
 */
export async function testAIConnection(): Promise<AIStatus> {
  return apiClient.post<AIStatus>("/ai/test-connection", {}, {
    timeoutMs: 20_000,
  });
}

/**
 * Get a label suggestion for a transaction
 */
export async function suggestLabel(
  request: SuggestLabelRequest,
): Promise<SuggestLabelResponse> {
  return apiClient.post<SuggestLabelResponse>("/ai/suggest-label", request);
}

/**
 * Execute a natural language query
 */
export async function executeNaturalQuery(
  request: NaturalQueryRequest,
): Promise<NaturalQueryResult> {
  return apiClient.post<NaturalQueryResult>("/ai/query", request, {
    timeoutMs: AI_NATURAL_QUERY_TIMEOUT_MS,
  });
}

// ========================================
// PROVIDER DISCOVERY AND MODEL LISTING
// ========================================

export interface DetectOllamaResponse {
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}

export interface DetectProviderRequest {
  endpoint: string;
  preferredProviderType?: AIProviderType;
  apiKey?: string;
}

export interface DetectProviderResponse {
  found: boolean;
  providerType?: AIProviderType;
  endpoint?: string;
  models?: ProviderModel[];
  message?: string;
  blockedReason?: string;
}

export interface ProviderModel {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface ListModelsResponse {
  models: ProviderModel[];
  error?: string;
}

/**
 * Auto-detect Ollama at common endpoints
 */
export async function detectOllama(): Promise<DetectOllamaResponse> {
  return apiClient.post<DetectOllamaResponse>("/ai/detect-ollama", {});
}

/**
 * Detect a provider at a typed endpoint
 */
export async function detectProvider(
  request: DetectProviderRequest,
): Promise<DetectProviderResponse> {
  try {
    return await apiClient.post<DetectProviderResponse>(
      "/ai/detect-provider",
      request,
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 502)) {
      const blockedReason =
        typeof error.response?.blockedReason === "string"
          ? error.response.blockedReason
          : undefined;
      return {
        found: false,
        message: error.message,
        blockedReason,
      };
    }

    throw error;
  }
}

/**
 * List available models from configured endpoint
 */
export async function listModels(): Promise<ListModelsResponse> {
  return apiClient.get<ListModelsResponse>("/ai/models");
}
