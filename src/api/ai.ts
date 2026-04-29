/**
 * AI API
 *
 * API calls for AI-powered features (transaction labeling, natural language queries)
 */

import apiClient from "./client";

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
  containerAvailable?: boolean;
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
// MODEL MANAGEMENT
// ========================================

export interface DetectOllamaResponse {
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}

export interface DetectProviderRequest {
  endpoint: string;
  preferredProviderType?: "ollama" | "openai-compatible";
  apiKey?: string;
}

export interface DetectProviderResponse {
  found: boolean;
  providerType?: "ollama" | "openai-compatible";
  endpoint?: string;
  models?: OllamaModel[];
  message?: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface ListModelsResponse {
  models: OllamaModel[];
  error?: string;
}

export interface PullModelResponse {
  success: boolean;
  model?: string;
  status?: string;
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
  return apiClient.post<DetectProviderResponse>("/ai/detect-provider", request);
}

/**
 * List available models from configured endpoint
 */
export async function listModels(): Promise<ListModelsResponse> {
  return apiClient.get<ListModelsResponse>("/ai/models");
}

/**
 * Pull (download) a model from an Ollama provider
 */
export async function pullModel(model: string): Promise<PullModelResponse> {
  return apiClient.post<PullModelResponse>("/ai/pull-model", { model });
}

export interface DeleteModelResponse {
  success: boolean;
  model?: string;
  error?: string;
}

/**
 * Delete a model from an Ollama provider
 */
export async function deleteModel(model: string): Promise<DeleteModelResponse> {
  return apiClient.delete<DeleteModelResponse>("/ai/delete-model", { model });
}

// ========================================
// SYSTEM RESOURCES CHECK
// ========================================

export interface SystemResources {
  ram: {
    total: number; // Total RAM in MB
    available: number; // Available RAM in MB
    required: number; // Minimum required RAM in MB
    sufficient: boolean;
  };
  disk: {
    total: number; // Total disk space in MB
    available: number; // Available disk space in MB
    required: number; // Minimum required disk in MB
    sufficient: boolean;
  };
  gpu: {
    available: boolean; // GPU detected
    name: string | null;
  };
  overall: {
    sufficient: boolean;
    warnings: string[];
  };
}

/**
 * Check system resources before enabling AI
 * Returns RAM, disk space, and GPU availability with sufficiency indicators.
 */
export async function getSystemResources(): Promise<SystemResources> {
  return apiClient.get<SystemResources>("/ai/system-resources");
}
