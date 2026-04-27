/**
 * AISettings Component Tests
 *
 * Tests for the AI Settings administration page.
 * Covers toggle, detection, model selection, model pull, and configuration.
 */

import { afterEach, beforeEach, vi } from 'vitest';

// Mock admin API
export const mockGetSystemSettings = vi.fn();
export const mockUpdateSystemSettings = vi.fn();
export const mockGetFeatureFlags = vi.fn();
export const mockGetMcpServerStatus = vi.fn();
export const mockListMcpApiKeys = vi.fn();
export const mockCreateMcpApiKey = vi.fn();
export const mockRevokeMcpApiKey = vi.fn();
export const mockGetUsers = vi.fn();

vi.mock('../../../src/api/admin', () => ({
  getSystemSettings: () => mockGetSystemSettings(),
  updateSystemSettings: (settings: Record<string, unknown>) => mockUpdateSystemSettings(settings),
  getFeatureFlags: () => mockGetFeatureFlags(),
  getMcpServerStatus: () => mockGetMcpServerStatus(),
  listMcpApiKeys: () => mockListMcpApiKeys(),
  createMcpApiKey: (input: Record<string, unknown>) => mockCreateMcpApiKey(input),
  revokeMcpApiKey: (keyId: string) => mockRevokeMcpApiKey(keyId),
  getUsers: () => mockGetUsers(),
}));

// Mock AI API
export const mockGetAIStatus = vi.fn();
export const mockDetectOllama = vi.fn();
export const mockListModels = vi.fn();
export const mockPullModel = vi.fn();
export const mockGetOllamaContainerStatus = vi.fn();
export const mockStartOllamaContainer = vi.fn();
export const mockStopOllamaContainer = vi.fn();

vi.mock('../../../src/api/ai', () => ({
  getAIStatus: () => mockGetAIStatus(),
  detectOllama: () => mockDetectOllama(),
  listModels: () => mockListModels(),
  pullModel: (model: string) => mockPullModel(model),
  getOllamaContainerStatus: () => mockGetOllamaContainerStatus(),
  startOllamaContainer: () => mockStartOllamaContainer(),
  stopOllamaContainer: () => mockStopOllamaContainer(),
}));

// Mock logger
vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock useModelDownloadProgress hook
vi.mock('../../../hooks/websocket', () => ({
  useModelDownloadProgress: () => ({ progress: null }),
}));

// Mock useAIStatus hook
vi.mock('../../../hooks/useAIStatus', () => ({
  invalidateAIStatusCache: vi.fn(),
}));

// Mock popular models response
export const mockPopularModels = {
  version: '1.0.0',
  lastUpdated: '2026-01-02',
  models: [
    { name: 'llama3.2:3b', description: 'Meta, fast & lightweight (2GB)', recommended: true },
    { name: 'deepseek-r1:7b', description: 'DeepSeek, reasoning model (4.7GB)' },
    { name: 'mistral:7b', description: 'Mistral AI, balanced (4GB)' },
  ],
};

// Mock global fetch for popular models
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes('popular-models.json')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPopularModels),
      } as Response);
    }
    return originalFetch(input as any);
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Default mock responses
export const defaultSettings = {
  aiEnabled: false,
  aiEndpoint: '',
  aiModel: '',
};

export const enabledSettings = {
  aiEnabled: true,
  aiEndpoint: 'http://host.docker.internal:11434',
  aiModel: 'llama3.2:3b',
  aiProviderProfiles: [{
    id: 'default-ollama',
    name: 'Default Ollama',
    providerType: 'ollama',
    endpoint: 'http://host.docker.internal:11434',
    model: 'llama3.2:3b',
    capabilities: { chat: true, toolCalls: false, strictJson: true },
    credentialState: { type: 'none', configured: false, needsReview: false },
  }],
  aiActiveProviderProfileId: 'default-ollama',
};

export const mockModels = {
  models: [
    { name: 'llama3.2:3b', size: 2000000000, modifiedAt: '2024-01-15' },
    { name: 'mistral:7b', size: 4000000000, modifiedAt: '2024-01-10' },
  ],
};

export function registerAISettingsTestHarness() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFeatureFlags.mockResolvedValue([
      { key: 'aiAssistant', enabled: true, description: 'Enable AI', category: 'general' },
    ]);
    mockGetSystemSettings.mockResolvedValue(defaultSettings);
    mockUpdateSystemSettings.mockResolvedValue({});
    mockGetMcpServerStatus.mockResolvedValue({
      enabled: true,
      host: '0.0.0.0',
      port: 3003,
      allowedHosts: ['localhost', 'sanctuary.local'],
      rateLimitPerMinute: 120,
      defaultPageSize: 100,
      maxPageSize: 500,
      maxDateRangeDays: 365,
      serverName: 'sanctuary',
      serverVersion: '0.8.44',
    });
    mockListMcpApiKeys.mockResolvedValue([]);
    mockCreateMcpApiKey.mockResolvedValue({
      id: 'created-key-1',
      userId: 'user-1',
      user: { id: 'user-1', username: 'alice', isAdmin: false },
      name: 'LAN model',
      keyPrefix: 'mcp_fixture',
      scope: { allowAuditLogs: false },
      createdAt: '2026-04-26T00:00:00.000Z',
      apiKey: 'mcp_test_token_visible_once',
    });
    mockRevokeMcpApiKey.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      name: 'LAN model',
      keyPrefix: 'mcp_fixture',
      scope: { allowAuditLogs: false },
      createdAt: '2026-04-26T00:00:00.000Z',
      revokedAt: '2026-04-27T00:00:00.000Z',
    });
    mockGetUsers.mockResolvedValue([
      { id: 'user-1', username: 'alice', email: null, emailVerified: true, isAdmin: false, createdAt: '2026-04-26T00:00:00.000Z' },
    ]);
    mockGetAIStatus.mockResolvedValue({ available: true, model: 'llama3.2:3b' });
    mockDetectOllama.mockResolvedValue({ found: true, endpoint: 'http://host.docker.internal:11434', models: ['llama3.2:3b'] });
    mockListModels.mockResolvedValue(mockModels);
    mockPullModel.mockResolvedValue({ success: true, model: 'llama3.2:3b' });
    mockGetOllamaContainerStatus.mockResolvedValue({ available: false, exists: false, running: false, status: 'not-available' });
    mockStartOllamaContainer.mockResolvedValue({ success: true, message: 'Container started' });
    mockStopOllamaContainer.mockResolvedValue({ success: true, message: 'Container stopped' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}
