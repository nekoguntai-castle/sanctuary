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
  direction: 'send' | 'receive';
  address?: string;
  date: Date;
  existingLabels?: string[];
}

/**
 * Natural language query result
 */
export interface QueryResult {
  type: 'transactions' | 'addresses' | 'utxos' | 'summary';
  filter?: Record<string, unknown>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
  limit?: number;
  aggregation?: 'sum' | 'count' | 'max' | 'min' | null;
}

/**
 * AI service configuration
 */
export interface AIConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
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
