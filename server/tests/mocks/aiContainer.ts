import { vi, type Mock } from 'vitest';
/**
 * AI Container Mock
 *
 * Mock responses for the AI container service used in testing.
 * Simulates the isolated AI container that handles external AI calls.
 */

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface MockHealthResponse {
  status: string;
  available?: boolean;
}

export interface MockConfigSyncResponse {
  success: boolean;
  message?: string;
}

export interface MockSuggestLabelRequest {
  transactionId: string;
}

export interface MockSuggestLabelResponse {
  suggestion: string;
}

export interface MockQueryRequest {
  query: string;
  walletId: string;
}

export interface MockQueryResponse {
  query: {
    type: 'transactions' | 'addresses' | 'utxos' | 'summary';
    filter?: Record<string, unknown>;
    sort?: {
      field: string;
      order: 'asc' | 'desc';
    };
    limit?: number;
    aggregation?: 'sum' | 'count' | 'max' | 'min' | null;
  };
}

export interface MockDetectOllamaResponse {
  found: boolean;
  endpoint?: string;
  models?: string[];
  message?: string;
}

export interface MockListModelsResponse {
  models: Array<{
    name: string;
    size: number;
    modifiedAt: string;
  }>;
  error?: string;
}

export interface MockPullModelResponse {
  success: boolean;
  model?: string;
  status?: string;
  error?: string;
}

// ========================================
// MOCK RESPONSES
// ========================================

export const mockHealthResponse: MockHealthResponse = {
  status: 'healthy',
  available: true,
};

export const mockUnhealthyResponse: MockHealthResponse = {
  status: 'unhealthy',
  available: false,
};

export const mockConfigSyncSuccess: MockConfigSyncResponse = {
  success: true,
  message: 'Configuration synced',
};

export const mockConfigSyncFailure: MockConfigSyncResponse = {
  success: false,
  message: 'Failed to sync configuration',
};

export const mockSuggestLabelResponses: Record<string, MockSuggestLabelResponse> = {
  'tx-receive-exchange': { suggestion: 'Exchange deposit' },
  'tx-send-exchange': { suggestion: 'Exchange withdrawal' },
  'tx-receive-mining': { suggestion: 'Mining reward' },
  'tx-send-payment': { suggestion: 'Payment' },
  'tx-receive-salary': { suggestion: 'Salary' },
  'tx-send-shopping': { suggestion: 'Shopping' },
  'tx-default': { suggestion: 'Transaction' },
};

export const mockQueryResponses: Record<string, MockQueryResponse> = {
  'largest-receives': {
    query: {
      type: 'transactions',
      filter: { type: 'receive' },
      sort: { field: 'amount', order: 'desc' },
      limit: 10,
    },
  },
  'recent-sends': {
    query: {
      type: 'transactions',
      filter: { type: 'send' },
      sort: { field: 'date', order: 'desc' },
      limit: 20,
    },
  },
  'unconfirmed': {
    query: {
      type: 'transactions',
      filter: { confirmations: 0 },
      sort: { field: 'date', order: 'desc' },
    },
  },
  'total-received': {
    query: {
      type: 'summary',
      filter: { type: 'receive' },
      aggregation: 'sum',
    },
  },
  'transaction-count': {
    query: {
      type: 'summary',
      aggregation: 'count',
    },
  },
  'labeled-exchange': {
    query: {
      type: 'transactions',
      filter: { label: 'Exchange' },
      sort: { field: 'date', order: 'desc' },
    },
  },
  'unused-addresses': {
    query: {
      type: 'addresses',
      filter: { used: false },
      limit: 5,
    },
  },
  'available-utxos': {
    query: {
      type: 'utxos',
      filter: { spent: false },
      sort: { field: 'amount', order: 'desc' },
    },
  },
};

export const mockDetectOllamaFound: MockDetectOllamaResponse = {
  found: true,
  endpoint: 'http://localhost:11434',
  models: ['llama2', 'codellama', 'mistral'],
};

export const mockDetectOllamaNotFound: MockDetectOllamaResponse = {
  found: false,
  message: 'No Ollama instance found at common endpoints',
};

export const mockListModelsResponse: MockListModelsResponse = {
  models: [
    { name: 'llama2', size: 3826793472, modifiedAt: '2024-01-15T10:00:00.000Z' },
    { name: 'llama2:13b', size: 7365960832, modifiedAt: '2024-01-14T15:30:00.000Z' },
    { name: 'codellama', size: 3826793472, modifiedAt: '2024-01-13T08:00:00.000Z' },
    { name: 'mistral', size: 4109854720, modifiedAt: '2024-01-12T12:00:00.000Z' },
  ],
};

export const mockListModelsEmpty: MockListModelsResponse = {
  models: [],
};

export const mockListModelsError: MockListModelsResponse = {
  models: [],
  error: 'Failed to connect to Ollama endpoint',
};

export const mockPullModelSuccess: MockPullModelResponse = {
  success: true,
  model: 'llama2',
  status: 'completed',
};

export const mockPullModelInProgress: MockPullModelResponse = {
  success: true,
  model: 'llama2:13b',
  status: 'downloading',
};

export const mockPullModelNotFound: MockPullModelResponse = {
  success: false,
  error: 'Model not found in registry',
};

export const mockPullModelError: MockPullModelResponse = {
  success: false,
  error: 'Failed to pull model: connection timeout',
};

// ========================================
// MOCK FETCH IMPLEMENTATION
// ========================================

/**
 * Create a mock fetch function that simulates AI container responses
 */
export function createAIContainerMock(options?: {
  healthy?: boolean;
  aiAvailable?: boolean;
  ollamaFound?: boolean;
}): Mock {
  const {
    healthy = true,
    aiAvailable = true,
    ollamaFound = true,
  } = options || {};

  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : {};

    // Health check endpoint
    if (url.includes('/health')) {
      return Promise.resolve({
        ok: healthy,
        json: () => Promise.resolve(healthy ? mockHealthResponse : mockUnhealthyResponse),
      });
    }

    // Config sync endpoint
    if (url.includes('/config') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockConfigSyncSuccess),
      });
    }

    // Test endpoint
    if (url.includes('/test') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ available: aiAvailable }),
      });
    }

    // Suggest label endpoint
    if (url.includes('/suggest-label') && method === 'POST') {
      if (!aiAvailable) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: 'AI not available' }),
        });
      }

      const transactionId = body.transactionId as string;
      const response = mockSuggestLabelResponses[transactionId] || mockSuggestLabelResponses['tx-default'];

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(response),
      });
    }

    // Natural query endpoint
    if (url.includes('/query') && method === 'POST') {
      if (!aiAvailable) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: 'AI not available' }),
        });
      }

      const query = (body.query as string)?.toLowerCase() || '';

      // Map query patterns to responses
      let responseKey = 'largest-receives'; // default

      if (query.includes('largest') && query.includes('receive')) {
        responseKey = 'largest-receives';
      } else if (query.includes('recent') && query.includes('send')) {
        responseKey = 'recent-sends';
      } else if (query.includes('unconfirmed')) {
        responseKey = 'unconfirmed';
      } else if (query.includes('total') && query.includes('received')) {
        responseKey = 'total-received';
      } else if (query.includes('count')) {
        responseKey = 'transaction-count';
      } else if (query.includes('exchange')) {
        responseKey = 'labeled-exchange';
      } else if (query.includes('unused') && query.includes('address')) {
        responseKey = 'unused-addresses';
      } else if (query.includes('utxo')) {
        responseKey = 'available-utxos';
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockQueryResponses[responseKey]),
      });
    }

    // Detect Ollama endpoint
    if (url.includes('/detect-ollama') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(ollamaFound ? mockDetectOllamaFound : mockDetectOllamaNotFound),
      });
    }

    // List models endpoint
    if (url.includes('/list-models')) {
      if (!ollamaFound) {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.resolve(mockListModelsError),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockListModelsResponse),
      });
    }

    // Pull model endpoint
    if (url.includes('/pull-model') && method === 'POST') {
      const model = body.model as string;

      if (model === 'nonexistent-model') {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve(mockPullModelNotFound),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ...mockPullModelSuccess,
          model,
        }),
      });
    }

    // Default: not found
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Endpoint not found' }),
    });
  });
}

// ========================================
// MOCK HELPERS
// ========================================

/**
 * Create a mock for specific transaction label suggestions
 */
export function createLabelSuggestionMock(suggestions: Record<string, string>): Mock {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/suggest-label') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      const suggestion = suggestions[body.transactionId] || 'Transaction';

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ suggestion }),
      });
    }

    return Promise.resolve({ ok: false, status: 404 });
  });
}

/**
 * Create a mock that simulates network failure
 */
export function createNetworkFailureMock(): Mock {
  return vi.fn().mockRejectedValue(new Error('Network error: Connection refused'));
}

/**
 * Create a mock that simulates timeout
 */
export function createTimeoutMock(): Mock {
  return vi.fn().mockRejectedValue(new Error('AbortError: The operation was aborted'));
}

/**
 * Create a mock that returns errors for all endpoints
 */
export function createErrorMock(statusCode: number = 500, errorMessage: string = 'Internal error'): Mock {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: statusCode,
    json: () => Promise.resolve({ error: errorMessage }),
  });
}

// ========================================
// RESET HELPER
// ========================================

/**
 * Reset all AI container mocks to default state
 */
export function resetAIContainerMocks(...mocks: Mock[]): void {
  mocks.forEach(mock => {
    if (mock && typeof mock.mockReset === 'function') {
      mock.mockReset();
    }
  });
}

export default {
  // Responses
  mockHealthResponse,
  mockUnhealthyResponse,
  mockConfigSyncSuccess,
  mockConfigSyncFailure,
  mockSuggestLabelResponses,
  mockQueryResponses,
  mockDetectOllamaFound,
  mockDetectOllamaNotFound,
  mockListModelsResponse,
  mockListModelsEmpty,
  mockListModelsError,
  mockPullModelSuccess,
  mockPullModelInProgress,
  mockPullModelNotFound,
  mockPullModelError,

  // Mock creators
  createAIContainerMock,
  createLabelSuggestionMock,
  createNetworkFailureMock,
  createTimeoutMock,
  createErrorMock,

  // Helpers
  resetAIContainerMocks,
};
