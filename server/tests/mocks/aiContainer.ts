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

export const mockSuggestLabelResponses: Record<
  string,
  MockSuggestLabelResponse
> = {
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
  unconfirmed: {
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
    {
      name: 'llama2',
      size: 3826793472,
      modifiedAt: '2024-01-15T10:00:00.000Z',
    },
    {
      name: 'llama2:13b',
      size: 7365960832,
      modifiedAt: '2024-01-14T15:30:00.000Z',
    },
    {
      name: 'codellama',
      size: 3826793472,
      modifiedAt: '2024-01-13T08:00:00.000Z',
    },
    {
      name: 'mistral',
      size: 4109854720,
      modifiedAt: '2024-01-12T12:00:00.000Z',
    },
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

interface ParsedMockRequest {
  method: string;
  body: Record<string, unknown>;
}

interface AIContainerMockState {
  healthy: boolean;
  aiAvailable: boolean;
  ollamaFound: boolean;
}

interface MockJsonOptions {
  ok?: boolean;
  status?: number;
}

type QueryResponseRule = {
  key: keyof typeof mockQueryResponses;
  matches: (query: string) => boolean;
};

const DEFAULT_QUERY_RESPONSE_KEY: keyof typeof mockQueryResponses =
  'largest-receives';

const QUERY_RESPONSE_RULES: QueryResponseRule[] = [
  {
    key: 'largest-receives',
    matches: (query) => query.includes('largest') && query.includes('receive'),
  },
  {
    key: 'recent-sends',
    matches: (query) => query.includes('recent') && query.includes('send'),
  },
  {
    key: 'unconfirmed',
    matches: (query) => query.includes('unconfirmed'),
  },
  {
    key: 'total-received',
    matches: (query) => query.includes('total') && query.includes('received'),
  },
  {
    key: 'transaction-count',
    matches: (query) => query.includes('count'),
  },
  {
    key: 'labeled-exchange',
    matches: (query) => query.includes('exchange'),
  },
  {
    key: 'unused-addresses',
    matches: (query) => query.includes('unused') && query.includes('address'),
  },
  {
    key: 'available-utxos',
    matches: (query) => query.includes('utxo'),
  },
];

function mockJsonResponse(body: unknown, options: MockJsonOptions = {}) {
  const { ok = true, status } = options;
  const response = {
    ok,
    ...(status === undefined ? {} : { status }),
    json: () => Promise.resolve(body),
  };

  return Promise.resolve(response);
}

function parseMockRequest(init?: RequestInit): ParsedMockRequest {
  return {
    method: init?.method || 'GET',
    body: init?.body ? JSON.parse(init.body as string) : {},
  };
}

function isEndpoint(url: string, path: string): boolean {
  return url.includes(path);
}

function isPostEndpoint(url: string, method: string, path: string): boolean {
  return isEndpoint(url, path) && method === 'POST';
}

function respondHealth(healthy: boolean) {
  return mockJsonResponse(
    healthy ? mockHealthResponse : mockUnhealthyResponse,
    {
      ok: healthy,
    },
  );
}

function respondConfigSync() {
  return mockJsonResponse(mockConfigSyncSuccess);
}

function respondTest(aiAvailable: boolean) {
  return mockJsonResponse({ available: aiAvailable });
}

function respondAIUnavailable() {
  return mockJsonResponse(
    { error: 'AI not available' },
    { ok: false, status: 503 },
  );
}

function respondSuggestLabel(
  aiAvailable: boolean,
  body: Record<string, unknown>,
) {
  if (!aiAvailable) {
    return respondAIUnavailable();
  }

  const transactionId = body.transactionId as string;
  return mockJsonResponse(
    mockSuggestLabelResponses[transactionId] ||
      mockSuggestLabelResponses['tx-default'],
  );
}

function resolveQueryResponseKey(
  query: string,
): keyof typeof mockQueryResponses {
  return (
    QUERY_RESPONSE_RULES.find((rule) => rule.matches(query))?.key ||
    DEFAULT_QUERY_RESPONSE_KEY
  );
}

function respondQuery(aiAvailable: boolean, body: Record<string, unknown>) {
  if (!aiAvailable) {
    return respondAIUnavailable();
  }

  const query = (body.query as string)?.toLowerCase() || '';
  return mockJsonResponse(mockQueryResponses[resolveQueryResponseKey(query)]);
}

function respondDetectOllama(ollamaFound: boolean) {
  return mockJsonResponse(
    ollamaFound ? mockDetectOllamaFound : mockDetectOllamaNotFound,
  );
}

function respondListModels(ollamaFound: boolean) {
  if (!ollamaFound) {
    return mockJsonResponse(mockListModelsError, { ok: false, status: 502 });
  }

  return mockJsonResponse(mockListModelsResponse);
}

function respondPullModel(body: Record<string, unknown>) {
  const model = body.model as string;

  if (model === 'nonexistent-model') {
    return mockJsonResponse(mockPullModelNotFound, { ok: false, status: 404 });
  }

  return mockJsonResponse({
    ...mockPullModelSuccess,
    model,
  });
}

function respondNotFound() {
  return mockJsonResponse(
    { error: 'Endpoint not found' },
    { ok: false, status: 404 },
  );
}

function dispatchAIContainerRequest(
  url: string,
  request: ParsedMockRequest,
  state: AIContainerMockState,
) {
  const { method, body } = request;

  if (isEndpoint(url, '/health')) {
    return respondHealth(state.healthy);
  }

  if (isPostEndpoint(url, method, '/config')) {
    return respondConfigSync();
  }

  if (isPostEndpoint(url, method, '/test')) {
    return respondTest(state.aiAvailable);
  }

  if (isPostEndpoint(url, method, '/suggest-label')) {
    return respondSuggestLabel(state.aiAvailable, body);
  }

  if (isPostEndpoint(url, method, '/query')) {
    return respondQuery(state.aiAvailable, body);
  }

  if (isPostEndpoint(url, method, '/detect-ollama')) {
    return respondDetectOllama(state.ollamaFound);
  }

  if (isEndpoint(url, '/list-models')) {
    return respondListModels(state.ollamaFound);
  }

  if (isPostEndpoint(url, method, '/pull-model')) {
    return respondPullModel(body);
  }

  return respondNotFound();
}

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
    return dispatchAIContainerRequest(url, parseMockRequest(init), {
      healthy,
      aiAvailable,
      ollamaFound,
    });
  });
}

// ========================================
// MOCK HELPERS
// ========================================

/**
 * Create a mock for specific transaction label suggestions
 */
export function createLabelSuggestionMock(
  suggestions: Record<string, string>,
): Mock {
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
  return vi
    .fn()
    .mockRejectedValue(new Error('Network error: Connection refused'));
}

/**
 * Create a mock that simulates timeout
 */
export function createTimeoutMock(): Mock {
  return vi
    .fn()
    .mockRejectedValue(new Error('AbortError: The operation was aborted'));
}

/**
 * Create a mock that returns errors for all endpoints
 */
export function createErrorMock(
  statusCode: number = 500,
  errorMessage: string = 'Internal error',
): Mock {
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
  mocks.forEach((mock) => {
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
