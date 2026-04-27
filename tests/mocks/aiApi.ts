/**
 * AI API Mock
 *
 * Mock implementations for the AI API used in frontend component testing.
 * Provides predictable responses for testing AI-powered features.
 */

import { vi } from 'vitest';

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
  type: 'transactions' | 'addresses' | 'utxos' | 'summary';
  filter?: Record<string, unknown>;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
  limit?: number;
  aggregation?: 'sum' | 'count' | 'max' | 'min' | null;
}

export interface DetectOllamaResponse {
  found: boolean;
  endpoint?: string;
  models?: string[];
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

// ========================================
// MOCK RESPONSES
// ========================================

export const mockAIStatusAvailable: AIStatus = {
  available: true,
  model: 'llama2',
  endpoint: 'http://localhost:11434',
};

export const mockAIStatusUnavailable: AIStatus = {
  available: false,
  message: 'AI is disabled or not configured',
};

export const mockAIStatusError: AIStatus = {
  available: false,
  error: 'AI container is not available',
};

export const mockLabelSuggestions: Record<string, string> = {
  'tx-receive-001': 'Exchange deposit',
  'tx-send-001': 'Exchange withdrawal',
  'tx-receive-002': 'Mining reward',
  'tx-send-002': 'Payment to vendor',
  'tx-receive-003': 'Salary payment',
  'tx-send-003': 'Shopping purchase',
  'tx-default': 'Transaction',
};

export const mockQueryResults: Record<string, NaturalQueryResult> = {
  'largest-receives': {
    type: 'transactions',
    filter: { type: 'receive' },
    sort: { field: 'amount', order: 'desc' },
    limit: 10,
  },
  'recent-sends': {
    type: 'transactions',
    filter: { type: 'send' },
    sort: { field: 'date', order: 'desc' },
    limit: 20,
  },
  'unconfirmed': {
    type: 'transactions',
    filter: { confirmations: 0 },
    sort: { field: 'date', order: 'desc' },
  },
  'exchange-labeled': {
    type: 'transactions',
    filter: { label: 'Exchange' },
    sort: { field: 'date', order: 'desc' },
  },
  'total-summary': {
    type: 'summary',
    aggregation: 'sum',
  },
};

export const mockModels: OllamaModel[] = [
  { name: 'llama2', size: 3826793472, modifiedAt: '2024-01-15T10:00:00.000Z' },
  { name: 'llama2:13b', size: 7365960832, modifiedAt: '2024-01-14T15:30:00.000Z' },
  { name: 'codellama', size: 3826793472, modifiedAt: '2024-01-13T08:00:00.000Z' },
  { name: 'mistral', size: 4109854720, modifiedAt: '2024-01-12T12:00:00.000Z' },
];

// ========================================
// MOCK API FUNCTIONS
// ========================================

export const mockGetAIStatus = vi.fn().mockResolvedValue(mockAIStatusAvailable);

export const mockSuggestLabel = vi.fn().mockImplementation(
  async (request: SuggestLabelRequest): Promise<SuggestLabelResponse> => {
    const suggestion = mockLabelSuggestions[request.transactionId] || mockLabelSuggestions['tx-default'];
    return { suggestion };
  }
);

export const mockExecuteNaturalQuery = vi.fn().mockImplementation(
  async (request: NaturalQueryRequest): Promise<NaturalQueryResult> => {
    const query = request.query.toLowerCase();

    if (query.includes('largest') && query.includes('receive')) {
      return mockQueryResults['largest-receives'];
    }
    if (query.includes('recent') && query.includes('send')) {
      return mockQueryResults['recent-sends'];
    }
    if (query.includes('unconfirmed')) {
      return mockQueryResults['unconfirmed'];
    }
    if (query.includes('exchange')) {
      return mockQueryResults['exchange-labeled'];
    }

    return mockQueryResults['total-summary'];
  }
);

export const mockDetectOllama = vi.fn().mockResolvedValue({
  found: true,
  endpoint: 'http://localhost:11434',
  models: ['llama2', 'codellama'],
} as DetectOllamaResponse);

export const mockListModels = vi.fn().mockResolvedValue({
  models: mockModels,
} as ListModelsResponse);

export const mockPullModel = vi.fn().mockResolvedValue({
  success: true,
  model: 'llama2',
  status: 'completed',
} as PullModelResponse);

// ========================================
// MOCK API MODULE
// ========================================

export const mockAiApi = {
  getAIStatus: mockGetAIStatus,
  suggestLabel: mockSuggestLabel,
  executeNaturalQuery: mockExecuteNaturalQuery,
  detectOllama: mockDetectOllama,
  listModels: mockListModels,
  pullModel: mockPullModel,
};

// ========================================
// SETUP HELPERS
// ========================================

/**
 * Configure the AI API mock for available state
 */
export function setupAIAvailable(): void {
  mockGetAIStatus.mockResolvedValue(mockAIStatusAvailable);
  mockSuggestLabel.mockImplementation(async (req: SuggestLabelRequest) => ({
    suggestion: mockLabelSuggestions[req.transactionId] || 'Transaction',
  }));
  mockExecuteNaturalQuery.mockResolvedValue(mockQueryResults['largest-receives']);
  mockListModels.mockResolvedValue({ models: mockModels });
  mockPullModel.mockResolvedValue({ success: true, model: 'llama2', status: 'completed' });
}

/**
 * Configure the AI API mock for unavailable state
 */
export function setupAIUnavailable(): void {
  mockGetAIStatus.mockResolvedValue(mockAIStatusUnavailable);
  mockSuggestLabel.mockRejectedValue(new Error('503: AI is not enabled'));
  mockExecuteNaturalQuery.mockRejectedValue(new Error('503: AI is not enabled'));
  mockListModels.mockResolvedValue({ models: [], error: 'No AI endpoint configured' });
  mockPullModel.mockResolvedValue({ success: false, error: 'No AI endpoint configured' });
}

/**
 * Configure the AI API mock for error state
 */
export function setupAIError(errorMessage: string = 'AI container is not available'): void {
  mockGetAIStatus.mockResolvedValue({ available: false, error: errorMessage });
  mockSuggestLabel.mockRejectedValue(new Error(errorMessage));
  mockExecuteNaturalQuery.mockRejectedValue(new Error(errorMessage));
  mockListModels.mockResolvedValue({ models: [], error: errorMessage });
  mockPullModel.mockResolvedValue({ success: false, error: errorMessage });
}

/**
 * Configure the AI API mock for rate limiting
 */
export function setupAIRateLimited(): void {
  mockSuggestLabel.mockRejectedValue(new Error('429: Too many requests'));
  mockExecuteNaturalQuery.mockRejectedValue(new Error('429: Too many requests'));
}

/**
 * Configure specific label suggestions
 */
export function setupLabelSuggestions(suggestions: Record<string, string>): void {
  mockSuggestLabel.mockImplementation(async (req: SuggestLabelRequest) => ({
    suggestion: suggestions[req.transactionId] || 'Transaction',
  }));
}

/**
 * Configure specific query results
 */
export function setupQueryResults(results: Record<string, NaturalQueryResult>): void {
  mockExecuteNaturalQuery.mockImplementation(async (req: NaturalQueryRequest) => {
    const query = req.query.toLowerCase();
    for (const [key, value] of Object.entries(results)) {
      if (query.includes(key)) {
        return value;
      }
    }
    return mockQueryResults['total-summary'];
  });
}

/**
 * Reset all AI API mocks to default state
 */
export function resetAIApiMocks(): void {
  mockGetAIStatus.mockReset();
  mockSuggestLabel.mockReset();
  mockExecuteNaturalQuery.mockReset();
  mockDetectOllama.mockReset();
  mockListModels.mockReset();
  mockPullModel.mockReset();

  // Restore default implementations
  setupAIAvailable();
}

// ========================================
// VITEST MOCK SETUP
// ========================================

/**
 * Create a vitest mock module for src/api/ai
 *
 * Usage in test files:
 * ```typescript
 * import { createAiApiMockModule } from '../mocks/aiApi';
 *
 * vi.mock('../../src/api/ai', () => createAiApiMockModule());
 * ```
 */
export function createAiApiMockModule() {
  return {
    getAIStatus: mockGetAIStatus,
    suggestLabel: mockSuggestLabel,
    executeNaturalQuery: mockExecuteNaturalQuery,
    detectOllama: mockDetectOllama,
    listModels: mockListModels,
    pullModel: mockPullModel,
  };
}

// ========================================
// TEST UTILITIES
// ========================================

/**
 * Create an async mock response that resolves after the current microtask.
 */
export function createDelayedMock<T>(response: T, _delayMs: number = 100): () => Promise<T> {
  return () => new Promise(resolve => queueMicrotask(() => resolve(response)));
}

/**
 * Create a mock that fails on first call then succeeds
 */
export function createRetryMock<T>(
  errorMessage: string,
  successResponse: T,
  failCount: number = 1
): () => Promise<T> {
  let callCount = 0;
  return () => {
    callCount++;
    if (callCount <= failCount) {
      return Promise.reject(new Error(errorMessage));
    }
    return Promise.resolve(successResponse);
  };
}

export default {
  // Mock responses
  mockAIStatusAvailable,
  mockAIStatusUnavailable,
  mockAIStatusError,
  mockLabelSuggestions,
  mockQueryResults,
  mockModels,

  // Mock functions
  mockGetAIStatus,
  mockSuggestLabel,
  mockExecuteNaturalQuery,
  mockDetectOllama,
  mockListModels,
  mockPullModel,
  mockAiApi,

  // Setup helpers
  setupAIAvailable,
  setupAIUnavailable,
  setupAIError,
  setupAIRateLimited,
  setupLabelSuggestions,
  setupQueryResults,
  resetAIApiMocks,
  createAiApiMockModule,

  // Test utilities
  createDelayedMock,
  createRetryMock,
};
