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

vi.mock('../../../src/api/admin', () => ({
  getSystemSettings: () => mockGetSystemSettings(),
  updateSystemSettings: (settings: Record<string, unknown>) => mockUpdateSystemSettings(settings),
  getFeatureFlags: () => mockGetFeatureFlags(),
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
