/**
 * AI Service Types
 *
 * Shared type definitions for the AI service modules.
 */

/**
 * Transaction context for label suggestions
 */
export interface TransactionContext {
  amount: number;
  direction: "send" | "receive";
  address?: string;
  date: Date;
  existingLabels?: string[];
}

/**
 * Natural language query result
 */
export const AI_QUERY_RESULT_TYPES = [
  "transactions",
  "addresses",
  "utxos",
  "summary",
] as const;
export const AI_QUERY_SORT_ORDERS = ["asc", "desc"] as const;
export const AI_QUERY_AGGREGATION_VALUES = [
  "sum",
  "count",
  "max",
  "min",
] as const;

export interface QueryResult {
  type: (typeof AI_QUERY_RESULT_TYPES)[number];
  filter?: Record<string, unknown>;
  sort?: {
    field: string;
    order: (typeof AI_QUERY_SORT_ORDERS)[number];
  };
  limit?: number;
  aggregation?: (typeof AI_QUERY_AGGREGATION_VALUES)[number] | null;
}

/**
 * AI service configuration
 */
export interface AIConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  providerProfileId?: string;
  providerType?: string;
  apiKey?: string;
  credentialConfiguredAt?: string;
}

/**
 * Config sync state tracking
 * SECURITY: Only sync config when it actually changes to avoid redundant requests
 */
export interface ConfigSyncState {
  lastHash: string;
  lastSyncTime: number;
  syncSuccess: boolean;
}

/**
 * AI Container Response Interfaces
 */
export interface AIHealthResponse {
  available: boolean;
  error?: string;
}

export interface AISuggestLabelResponse {
  suggestion: string | null;
}

export interface AIQueryResponse {
  query: QueryResult | null;
}

export interface AIDetectOllamaResponse {
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}

export interface AIDetectProviderResponse {
  found: boolean;
  providerType?: "ollama" | "openai-compatible";
  endpoint?: string;
  models?: Array<{ name: string; size: number; modifiedAt: string }>;
  message?: string;
  blockedReason?: string;
}

export interface AIListModelsResponse {
  models: Array<{ name: string; size: number; modifiedAt: string }>;
  error?: string;
}

export interface AIPullModelResponse {
  success: boolean;
  model?: string;
  status?: string;
  error?: string;
}
